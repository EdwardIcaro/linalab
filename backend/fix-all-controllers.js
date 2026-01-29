const fs = require('fs');
const path = require('path');

const controllersDir = path.join(__dirname, 'src', 'controllers');

function fixControllerFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  const fileName = path.basename(filePath);

  // 1. Remover validações duplicadas de Array.isArray
  const beforeDuplicateRemoval = content;
  content = content.replace(
    /(if \(Array\.isArray\(id\)\) {\s+return res\.status\(400\)\.json\({ error: ['"]ID inválido['"] }\);\s+}\s+)\1+/g,
    '$1'
  );
  content = content.replace(
    /(if \(Array\.isArray\(placa\)\) {\s+return res\.status\(400\)\.json\({ error: ['"]Placa inválida['"] }\);\s+}\s+)\1+/g,
    '$1'
  );
  if (content !== beforeDuplicateRemoval) {
    console.log(`  - Removed duplicate Array.isArray checks`);
    modified = true;
  }

  // 2. Adicionar validação após const { id } = req.params; se não existir
  const idParamsRegex = /const { id } = req\.params;(?!\s*if \(Array\.isArray\(id\)\))/g;
  const matches = content.match(idParamsRegex);
  if (matches && matches.length > 0) {
    content = content.replace(
      /const { id } = req\.params;(?!\s*if \(Array\.isArray\(id\)\))/g,
      `const { id } = req.params;\n\n    if (Array.isArray(id)) {\n      return res.status(400).json({ error: 'ID inválido' });\n    }`
    );
    console.log(`  - Added ${matches.length} Array.isArray(id) validation(s)`);
    modified = true;
  }

  // 3. Adicionar validação após const { placa } = req.params; se não existir
  const placaParamsRegex = /const { placa } = req\.params;(?!\s*(?:if \(Array\.isArray\(placa\)\)|if \(!placa \|\| Array\.isArray\(placa\)\)))/g;
  const placaMatches = content.match(placaParamsRegex);
  if (placaMatches && placaMatches.length > 0) {
    content = content.replace(
      /const { placa } = req\.params;(?!\s*(?:if \(Array\.isArray\(placa\)\)|if \(!placa \|\| Array\.isArray\(placa\)\)))/g,
      `const { placa } = req.params;\n\n    if (Array.isArray(placa)) {\n      return res.status(400).json({ error: 'Placa inválida' });\n    }`
    );
    console.log(`  - Added ${placaMatches.length} Array.isArray(placa) validation(s)`);
    modified = true;
  }

  // 4. Substituir { equals: placa } por apenas placa
  if (content.includes('placa: { equals: placa }')) {
    content = content.replace(/placa: { equals: placa }/g, 'placa');
    console.log(`  - Replaced 'placa: { equals: placa }' with 'placa'`);
    modified = true;
  }

  // 5. Corrigir problema de _count sem select adequado
  // Procurar por findFirst com include: { _count } mas sem select no objeto principal
  const findFirstWithCountRegex = /const (\w+) = await prisma\.(\w+)\.findFirst\(\{[\s\S]*?include: \{[\s\S]*?_count:/g;
  const needsSelectFix = [];
  let match;

  while ((match = findFirstWithCountRegex.exec(content)) !== null) {
    const varName = match[1];
    const model = match[2];

    // Verificar se já tem select
    const startPos = match.index;
    const findFirstBlock = content.substring(startPos, startPos + 500);

    if (!findFirstBlock.includes('select: {') && findFirstBlock.includes('_count:')) {
      needsSelectFix.push({ varName, model, pos: startPos });
    }
  }

  if (needsSelectFix.length > 0) {
    // Para cada ocorrência, adicionar select
    for (const fix of needsSelectFix.reverse()) { // Reverse para não bagunçar os índices
      const beforeBlock = content.substring(0, fix.pos);
      const afterBlock = content.substring(fix.pos);

      // Encontrar o include: { e adicionar select antes
      const modifiedAfter = afterBlock.replace(
        /(const \w+ = await prisma\.\w+\.findFirst\(\{\s+where: \{[^}]+\},\s+)(include: \{)/,
        `$1select: {\n        id: true,\n        $2`
      );

      if (modifiedAfter !== afterBlock) {
        content = beforeBlock + modifiedAfter;
        console.log(`  - Added select clause for _count compatibility`);
        modified = true;
      }
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

// Processar todos os controllers
console.log('Fixing TypeScript errors in controllers...\n');

const files = fs.readdirSync(controllersDir).filter(f => f.endsWith('Controller.ts'));
let fixedCount = 0;

files.forEach(file => {
  const filePath = path.join(controllersDir, file);
  console.log(`Checking ${file}:`);

  if (fixControllerFile(filePath)) {
    fixedCount++;
    console.log(`  ✓ Fixed\n`);
  } else {
    console.log(`  - No changes needed\n`);
  }
});

console.log(`\n✓ Fixed ${fixedCount}/${files.length} controller files`);
console.log('\nRun: npx tsc --noEmit to check for remaining errors');
