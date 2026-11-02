import fs from 'fs';
import path from 'path';

export function getAdminSpaHtml(): string {
  const possiblePaths = [
    path.resolve(process.cwd(), 'backend/public/admin.html'),
    path.resolve(process.cwd(), 'public/admin.html'),
    path.resolve(process.cwd(), 'backend/index.html'),
    path.resolve(process.cwd(), 'public/index.html'),
    path.resolve(process.cwd(), 'index.html'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf8');
        if (content.includes('id="root"') && content.includes('index-Cb5xK52G.js')) {
          return content;
        }
      } catch (err) {
        // continue
      }
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
    <title>Earn Street • Royal Administration Portal</title>
    <meta name="description" content="Earn Street Administration & Operations Management Portal" />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23FFD45A'><path d='M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z'/></svg>" />
    <script>
      if (window.location.pathname === '/' || window.location.pathname === '/login') {
        window.location.replace('/adminpanal');
      }
    </script>
    <script type="module" crossorigin src="/assets/index-Cb5xK52G.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-BDeP-j3d.css">
  </head>
  <body class="bg-[#020712] text-slate-100 font-sans antialiased selection:bg-[#1459E8] selection:text-white min-h-screen">
    <div id="root"></div>
  </body>
</html>`;
}
