import fs from 'node:fs';
const r = p => fs.readFileSync(p, 'utf8');
fs.rmSync('www', {recursive: true, force: true});
fs.mkdirSync('www/fonts', {recursive: true});
for (const f of ['figtree-latin-400-normal','figtree-latin-500-normal','figtree-latin-600-normal','figtree-latin-700-normal'])
  fs.copyFileSync(`node_modules/@fontsource/figtree/files/${f}.woff2`, `www/fonts/${f}.woff2`);
for (const f of ['bricolage-grotesque-latin-600-normal','bricolage-grotesque-latin-700-normal'])
  fs.copyFileSync(`node_modules/@fontsource/bricolage-grotesque/files/${f}.woff2`, `www/fonts/${f}.woff2`);
fs.copyFileSync('node_modules/@capacitor/core/dist/capacitor.js', 'www/capacitor.js');
const sm = r('src/style-markup.html').replace('</style>', r('src/extra.css') + '\n</style>');
const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Orçamento Familiar</title>
${sm.split('<div class="app">')[0]}
</head>
<body>
<div class="app">${sm.split('<div class="app">')[1]}
<script src="capacitor.js"></script>
<script>
${r('src/app.js')}
</script>
</body>
</html>
`;
fs.writeFileSync('www/index.html', html);
console.log('www/index.html', html.length, 'bytes');
