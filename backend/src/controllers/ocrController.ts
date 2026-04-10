import { Request, Response } from 'express';

/**
 * Proxy para Plate Recognizer API
 * Recebe imagem base64 do frontend, envia para a API externa e retorna a placa detectada.
 * A key fica segura no backend — não exposta no frontend.
 */
export const reconhecerPlaca = async (req: Request, res: Response) => {
  try {
    const { image } = req.body;

    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Imagem não fornecida' });
    }

    const apiKey = process.env.PLATE_RECOGNIZER_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'OCR de placa não configurado. Adicione PLATE_RECOGNIZER_KEY no ambiente.' });
    }

    // Remover prefixo data URL e converter para Buffer
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Usar FormData nativo (disponível no Node 20+)
    const form = new FormData();
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    form.append('upload', blob, 'plate.jpg');
    form.append('regions', 'br'); // Focar em placas brasileiras

    const response = await fetch('https://api.platerecognizer.com/v1/plate-reader/', {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OCR] Plate Recognizer error:', response.status, errorText);
      return res.status(502).json({ error: 'Erro ao processar imagem na API externa' });
    }

    const data = (await response.json()) as {
      results?: Array<{ plate: string; score: number; region?: { code: string } }>;
    };

    if (!data.results || data.results.length === 0) {
      return res.json({ placa: null, confidence: 0 });
    }

    const result = data.results[0];
    // Normalizar: uppercase sem hífen nem espaço
    const placa = result.plate.toUpperCase().replace(/[-\s]/g, '');
    const confidence = Math.round((result.score || 0) * 100);

    return res.json({ placa, confidence });
  } catch (error) {
    console.error('[OCR] Erro interno:', error);
    return res.status(500).json({ error: 'Erro interno ao processar OCR' });
  }
};
