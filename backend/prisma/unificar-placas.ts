/**
 * Junta os veículos com a mesma placa gravada em grafias diferentes ("ABC1D23", "abc-1d23"...).
 *
 *   npx ts-node prisma/unificar-placas.ts            → só mostra o que faria (não grava nada)
 *   npx ts-node prisma/unificar-placas.ts --aplicar  → grava
 *
 * Por placa: fica o registro já padronizado (ou o mais recente), com o modelo/cor do cadastro
 * mexido por último; as ordens dos outros passam para ele e os outros são apagados.
 * As ordens são movidas ANTES de apagar (OrdemServico.veiculo é onDelete: Cascade).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const aplicar = process.argv.includes('--aplicar');
const norm = (p: string) => p.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

async function main() {
  const todos = await prisma.veiculo.findMany({
    select: { id: true, placa: true, modelo: true, cor: true, clienteId: true, updatedAt: true, _count: { select: { ordens: true } } },
    orderBy: { updatedAt: 'desc' },
  });

  const grupos = new Map<string, typeof todos>();
  for (const v of todos) {
    const k = norm(v.placa);
    if (!k) continue;
    grupos.set(k, [...(grupos.get(k) ?? []), v]);
  }

  let juntadas = 0, renomeadas = 0, ordensMovidas = 0;
  for (const [placa, lista] of grupos) {
    const fica = lista.find((v) => v.placa === placa) ?? lista[0];
    const recente = lista[0]; // lista já vem do mais recente para o mais antigo
    const sai = lista.filter((v) => v.id !== fica.id);
    if (!sai.length && fica.placa === placa) continue;

    if (sai.length) {
      juntadas++;
      const nOrd = sai.reduce((s, v) => s + v._count.ordens, 0);
      ordensMovidas += nOrd;
      console.log(`${placa}: fica ${fica.placa} (${recente.modelo ?? '-'}) · junta ${sai.map((v) => `${v.placa} (${v.modelo ?? '-'})`).join(', ')} · ${nOrd} ordem(ns) movida(s)`);
    } else {
      renomeadas++;
      console.log(`${placa}: renomeia ${fica.placa} → ${placa}`);
    }
    if (!aplicar) continue;

    await prisma.$transaction(async (tx) => {
      if (sai.length) {
        await tx.ordemServico.updateMany({ where: { veiculoId: { in: sai.map((v) => v.id) } }, data: { veiculoId: fica.id } });
        await tx.veiculo.deleteMany({ where: { id: { in: sai.map((v) => v.id) } } });
      }
      await tx.veiculo.update({
        where: { id: fica.id },
        data: { placa, modelo: recente.modelo ?? fica.modelo, cor: recente.cor ?? fica.cor },
      });
    });
  }

  console.log(`\n${juntadas} placa(s) duplicada(s), ${ordensMovidas} ordem(ns) movida(s), ${renomeadas} placa(s) só padronizada(s).`);
  console.log(aplicar ? 'Gravado.' : 'Nada foi gravado. Rode com --aplicar para gravar.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
