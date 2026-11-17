import { PDFDocument, PDFName, PDFArray, TextAlignment, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export const CLIENT_FIELDS = ['clientCompany','clientContact','clientTaxId','clientPhone'];

export async function addClientFields(bytes, fields, fontBytes) {
  if (!fields.length) return bytes;
  if (fields.length > 4 || new Set(fields.map(f=>f.name)).size !== fields.length) throw new Error('PDF_FORM_FIELDS_INVALID');
  const doc=await PDFDocument.load(bytes);
  doc.registerFontkit(fontkit);
  // Keep the complete font: recipients may type Chinese characters not in the quotation.
  const font=await doc.embedFont(fontBytes,{subset:false});
  await font.embed();
  // Editors write Unicode CIDs, while pdf-lib's appearance font uses glyph IDs.
  const source=fontkit.create(new Uint8Array(fontBytes));
  const map=new Uint8Array(65536*2), widths=[];
  for (const cp of source.characterSet.filter(cp=>cp<=65535)) {
    const glyph=source.glyphForCodePoint(cp);
    map[cp*2]=glyph.id>>8; map[cp*2+1]=glyph.id&255;
    widths.push(cp,[glyph.advanceWidth*1000/source.unitsPerEm]);
  }
  const original=doc.context.lookup(font.ref);
  const editable=original.clone();
  const descendant=original.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0).clone();
  descendant.set(PDFName.of('CIDToGIDMap'),doc.context.register(doc.context.flateStream(map)));
  descendant.set(PDFName.of('W'),doc.context.obj(widths));
  editable.set(PDFName.of('DescendantFonts'),doc.context.obj([doc.context.register(descendant)]));
  editable.set(PDFName.of('ToUnicode'),doc.context.register(doc.context.flateStream('/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /KinoUnicode def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfrange <0000> <D7FF> <0000> <E000> <FFFF> <E000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end')));
  const editableRef=doc.context.register(editable);
  const form=doc.getForm();
  form.acroForm.dict.set(PDFName.of('DR'),doc.context.obj({Font:{KinoEditable:editableRef,[font.name]:font.ref}}));
  for (const field of fields) {
    const page=doc.getPage(field.page);
    const {x,y,width,height}=field;
    if (!CLIENT_FIELDS.includes(field.name) || ![x,y,width,height].every(Number.isFinite) || width<=0 || height<=0 || x<0 || y<0 || x+width>page.getWidth()+1 || y+height>page.getHeight()+1) throw new Error('PDF_FORM_RECT_INVALID');
    const input=form.createTextField(field.name);
    input.setAlignment(TextAlignment.Center);
    input.setText(field.value || '');
    input.addToPage(page,{x,y,width,height,borderWidth:0,borderColor:rgb(1,1,1),backgroundColor:undefined,font,textColor:rgb(0.094,0.133,0.188)});
    for(const widget of input.acroField.getWidgets()) {
      widget.dict.set(PDFName.of('BS'),doc.context.obj({W:0}));
      widget.dict.set(PDFName.of('Border'),doc.context.obj([0,0,0]));
    }
    input.setFontSize(Math.min(field.fontSize || 8,height*.65));
    input.updateAppearances(font);
    input.acroField.setDefaultAppearance('/KinoEditable '+Math.min(field.fontSize || 8,height*.65)+' Tf 0.094 0.133 0.188 rg');
  }
  return doc.save({updateFieldAppearances:false});
}
