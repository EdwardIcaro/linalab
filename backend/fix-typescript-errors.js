const fs = require('fs');
const path = require('path');

const controllersDir = path.join(__dirname, 'src', 'controllers');

// Função para adicionar validação de array após destructuring de params
function fixController(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Padrão 1: const { id } = req.params; seguido por uso em where
  const pattern1 = /const { id } = req\.params;(\s+)((?!if \(Array\.isArray\(id\)\)))/g;
  if (pattern1.test(content)) {
    content = content.replace(
      /const { id } = req\.params;(\s+)((?!if \(Array\.isArray\(id\)\)))/g,
      `const { id } = req.params;$1$1if (Array.isArray(id)) {$1  return res.status(400).json({ error: 'ID inválido' });$1}$1$1`
    );
    modified = true;
  }

  // Padrão 2: const { placa } = req.params; seguido por uso
  const pattern2 = /const { placa } = req\.params;(\s+)((?!if \(Array\.isArray\(placa\)\)|if \(!placa \|\| Array\.isArray\(placa\)\)))/g;
  if (pattern2.test(content)) {
    content = content.replace(
      /const { placa } = req\.params;(\s+)((?!if \(Array\.isArray\(placa\)\)|if \(!placa \|\| Array\.isArray\(placa\)\)))/g,
      `const { placa } = req.params;$1$1if (Array.isArray(placa)) {$1  return res.status(400).json({ error: 'Placa inválida' });$1}$1$1`
    );
    modified = true;
  }

  // Padrão 3: Trocar { equals: placa } por apenas placa
  if (content.includes('{ equals: placa }')) {
    content = content.replace(/placa: { equals: placa }/g, 'placa');
    modified = true;
  }

  // Padrão 4: Corrigir _count em select (adicionar select quando falta)
  const pattern4 = /include: {\s+_count: {\s+select: {([^}]+)}\s+}\s+}/g;
  if (pattern4.test(content) && !content.includes('select: {') && content.includes('findFirst')) {
    content = content.replace(
      /(const \w+ = await prisma\.\w+\.findFirst\({\s+where: {[^}]+},\s+)(include: {)/g,
      '$1select: {\n        id: true,\n        $2'
    );
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ Fixed: ${path.basename(filePath)}`);
    return true;
  }
  return false;
}

// Processar todos os arquivos de controller
const files = fs.readdirSync(controllersDir);
let fixedCount = 0;

files.forEach(file => {
  if (file.endsWith('Controller.ts')) {
    const filePath = path.join(controllersDir, file);
    if (fixController(filePath)) {
      fixedCount++;
    }
  }
});

console.log(`\n✓ Fixed ${fixedCount} controller files`);
console.log('Run: pnpm run dev to test');
