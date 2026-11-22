// Derive raster platform icons from the committed vector; no external image service.
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
(async()=>{
  const folder=path.resolve(__dirname,'../assets/branding'),svg=fs.readFileSync(path.join(folder,'qt-app.svg'),'utf8');
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage();
    for(const size of [32,180,192,512]){
      await page.setViewportSize({width:size,height:size});
      await page.setContent('<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>'+svg);
      await page.screenshot({path:path.join(folder,`qt-${size}.png`)});
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
