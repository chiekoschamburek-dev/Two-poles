from pathlib import Path
from pypdf import PdfReader
from PIL import Image, ImageDraw, ImageFont
root=Path(r'D:\桌面\project\project\artifacts\fitness-design\qa')
pdf=PdfReader(root/'final-v2.pdf')
for i,p in enumerate(pdf.pages):
 t=p.extract_text() or ''
 print(f'PAGE {i+1:02d} chars={len(t)} START={t[:90]!r} END={t[-95:]!r}')
(root/'final-v2-text.txt').write_text('\n\n'.join(f'=== PAGE {i+1} ===\n{p.extract_text()}' for i,p in enumerate(pdf.pages)),encoding='utf8')
imgs=sorted((root/'final-v2-render').glob('page-*.png'))
for start in range(0,len(imgs),4):
 sheet=Image.new('RGB',(1260,1830),'#c6cbd1');d=ImageDraw.Draw(sheet)
 for j,p in enumerate(imgs[start:start+4]):
  im=Image.open(p);im.thumbnail((605,865));x=15+(j%2)*630;y=35+(j//2)*910
  sheet.paste(im,(x,y));d.text((x,y-22),str(start+j+1),fill='black',font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',20))
 sheet.save(root/f'v2-review-{start//4+1}.png')
