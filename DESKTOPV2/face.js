/**
 * face.js — reconhecimento facial do ponto (Data Point)
 *
 * Módulo compartilhado por:
 *   face.html   → enrollment (cadastro do rosto, coleta N amostras)
 *   ponto.html  → verificação 1:1 (confere se é o dono do token)
 *
 * A biblioteca (1.3 MB) e os modelos (6.8 MB) são carregados sob demanda:
 * quem não usa facial não baixa nada.
 *
 * Nada de foto ou vídeo sai do aparelho — só o vetor de 128 números,
 * que é irreversível.
 */
(function (global) {
  'use strict';

  const LIB      = '/face-api.min.js';
  const MODELS   = '/models';

  // Distância euclidiana máxima entre dois vetores para considerar a mesma
  // pessoa. 0.6 é o valor de referência do modelo; usamos 0.55 por segurança.
  const THRESHOLD = 0.55;

  // Amostra só é aceita se o rosto ocupar entre 12% e 65% da largura do quadro
  // e a detecção tiver confiança mínima.
  const MIN_LARGURA   = 0.12;
  const MAX_LARGURA   = 0.65;
  const MIN_SCORE     = 0.60;

  // No enrollment, amostra que destoar mais que isso da média é descartada
  // (rosto virado, olho fechado, borrão de movimento).
  const MAX_DESVIO    = 0.40;

  let libPromise    = null;
  let modelsPromise = null;
  let stream        = null;

  // ── carregamento ────────────────────────────────────────────────────────────

  function carregarLib() {
    if (libPromise) return libPromise;
    libPromise = new Promise((resolve, reject) => {
      if (global.faceapi) return resolve(global.faceapi);
      const s = document.createElement('script');
      s.src = LIB;
      s.onload  = () => global.faceapi ? resolve(global.faceapi) : reject(new Error('lib-invalida'));
      s.onerror = () => reject(new Error('lib-falhou'));
      document.head.appendChild(s);
    });
    return libPromise;
  }

  function carregarModelos() {
    if (modelsPromise) return modelsPromise;
    modelsPromise = carregarLib().then((faceapi) => Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODELS),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODELS),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODELS),
    ]));
    return modelsPromise;
  }

  /**
   * Prepara tudo. onEtapa recebe 'lib' | 'modelos' | 'pronto'.
   */
  async function ready(onEtapa) {
    onEtapa && onEtapa('lib');
    await carregarLib();
    onEtapa && onEtapa('modelos');
    await carregarModelos();
    onEtapa && onEtapa('pronto');
  }

  /**
   * O aparelho consegue rodar? Checa câmera e WebGL.
   * Se retornar false, a página deve pular a facial em vez de travar.
   */
  function isSupported() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch {
      return false;
    }
  }

  // ── câmera ──────────────────────────────────────────────────────────────────

  async function startCamera(videoEl) {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play().catch(() => {});
    // espera o primeiro frame ter dimensão real
    if (!videoEl.videoWidth) {
      await new Promise((r) => videoEl.addEventListener('loadeddata', r, { once: true }));
    }
    return stream;
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  // ── detecção ────────────────────────────────────────────────────────────────

  /**
   * Uma tentativa de leitura do frame atual.
   * → { ok: true, embedding: number[128] }
   * → { ok: false, motivo: 'sem-rosto' | 'longe' | 'perto' | 'baixa-confianca' }
   */
  async function sample(videoEl) {
    const faceapi = await carregarLib();
    if (!videoEl.videoWidth) return { ok: false, motivo: 'sem-rosto' };

    const det = await faceapi
      .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!det) return { ok: false, motivo: 'sem-rosto' };
    if (det.detection.score < MIN_SCORE) return { ok: false, motivo: 'baixa-confianca' };

    const prop = det.detection.box.width / videoEl.videoWidth;
    if (prop < MIN_LARGURA) return { ok: false, motivo: 'longe' };
    if (prop > MAX_LARGURA) return { ok: false, motivo: 'perto' };

    return { ok: true, embedding: Array.from(det.descriptor) };
  }

  // ── vetores ─────────────────────────────────────────────────────────────────

  function mean(lista) {
    const soma = new Array(128).fill(0);
    lista.forEach((v) => { for (let i = 0; i < 128; i++) soma[i] += v[i]; });
    return soma.map((x) => x / lista.length);
  }

  function distance(a, b) {
    let s = 0;
    for (let i = 0; i < 128; i++) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
  }

  // ── enrollment ──────────────────────────────────────────────────────────────

  /**
   * Coleta amostras válidas até chegar em `alvo` (ou estourar o tempo).
   * Descarta as que destoam da média e devolve o vetor consolidado.
   *
   * onProgresso({ validas, alvo, motivo }) é chamado a cada tentativa —
   * `motivo` vem preenchido quando a amostra foi rejeitada.
   *
   * → { ok: true, embedding, amostras } | { ok: false, erro }
   */
  async function enroll(videoEl, opts) {
    const alvo      = (opts && opts.alvo) || 8;
    const timeoutMs = (opts && opts.timeoutMs) || 45000;
    const onProg    = opts && opts.onProgresso;

    const coletadas = [];
    const limite    = Date.now() + timeoutMs;

    while (coletadas.length < alvo && Date.now() < limite) {
      const r = await sample(videoEl);
      if (r.ok) coletadas.push(r.embedding);
      onProg && onProg({ validas: coletadas.length, alvo, motivo: r.ok ? null : r.motivo });
      await new Promise((res) => setTimeout(res, r.ok ? 350 : 120));
    }

    if (coletadas.length < 4) return { ok: false, erro: 'amostras-insuficientes' };

    // descarta outliers e recalcula
    const media  = mean(coletadas);
    const limpas = coletadas.filter((v) => distance(v, media) <= MAX_DESVIO);
    const finais = limpas.length >= 4 ? limpas : coletadas;

    return { ok: true, embedding: mean(finais), amostras: finais.length };
  }

  // ── verificação 1:1 ─────────────────────────────────────────────────────────

  /**
   * Confere se quem está na câmera é o dono de `referencia`.
   * Como o token do link já diz quem é a pessoa, não há busca 1:N —
   * só a comparação contra um único vetor, o que é rápido até em aparelho fraco.
   *
   * Exige 2 leituras boas seguidas para evitar acerto por acaso.
   *
   * → { ok: true, score } | { ok: false, erro: 'tempo-esgotado', melhor }
   */
  async function verify(videoEl, referencia, opts) {
    const timeoutMs = (opts && opts.timeoutMs) || 20000;
    const limiar    = (opts && opts.threshold) || THRESHOLD;
    const onProg    = opts && opts.onProgresso;

    const limite  = Date.now() + timeoutMs;
    let seguidas  = 0;
    let melhorDist = Infinity;

    while (Date.now() < limite) {
      const r = await sample(videoEl);

      if (r.ok) {
        const d = distance(r.embedding, referencia);
        if (d < melhorDist) melhorDist = d;

        if (d <= limiar) {
          seguidas++;
          if (seguidas >= 2) {
            // score 0-1: quanto menor a distância, maior a confiança
            return { ok: true, score: Math.max(0, Math.min(1, 1 - melhorDist / limiar * 0.5)) };
          }
        } else {
          seguidas = 0;
        }
        onProg && onProg({ motivo: d <= limiar ? 'confere' : 'nao-confere', distancia: d });
      } else {
        seguidas = 0;
        onProg && onProg({ motivo: r.motivo });
      }

      await new Promise((res) => setTimeout(res, 150));
    }

    return { ok: false, erro: 'tempo-esgotado', melhor: melhorDist };
  }

  // ── mensagens ───────────────────────────────────────────────────────────────

  const TEXTOS = {
    'sem-rosto':        'Nenhum rosto detectado',
    'longe':            'Aproxime o rosto',
    'perto':            'Afaste um pouco',
    'baixa-confianca':  'Melhore a iluminação',
    'nao-confere':      'Continue olhando para a câmera',
    'confere':          'Reconhecendo...',
  };

  function texto(motivo) {
    return TEXTOS[motivo] || 'Posicione seu rosto';
  }

  global.LinaFace = {
    ready, isSupported, startCamera, stopCamera,
    sample, enroll, verify, mean, distance, texto,
    THRESHOLD,
  };
})(window);
