import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../cloud-sync/package.json',import.meta.url));
const {PDFDocument, PDFName}=require('pdf-lib');
import {addClientFields} from '../cloud-sync/src/pdf-form.js';

test('client form preserves Chinese values and widget rectangles after saving',async()=>{
  const original=await PDFDocument.create();
  original.addPage([595.28,841.89]);
  const font=await fs.readFile(new URL('../assets/pdf/NotoSansTC-Regular.ttf',import.meta.url));
  const fields=['clientCompany','clientContact','clientTaxId','clientPhone'].map((name,i)=>({name,page:0,value:i===1?'甲方王先生':'',x:60,y:400-i*20,width:200,height:15,fontSize:8}));
  const bytes=await addClientFields(await original.save(),fields,font);
  const doc=await PDFDocument.load(bytes), form=doc.getForm();
  assert.equal(form.getFields().length,4);
  assert.equal(form.getTextField('clientContact').getText(),'甲方王先生');
  const widget=form.getTextField('clientContact').acroField.getWidgets()[0];
  assert.equal(widget.getRectangle().y,380);
  assert.ok(widget.dict.get(PDFName.of('AP')));
  assert.ok(form.acroForm.dict.get(PDFName.of('DR')));
  form.getTextField('clientCompany').setText('客戶測試股份有限公司');
  doc.registerFontkit(require('@pdf-lib/fontkit'));
  const embedded=await doc.embedFont(font,{subset:false});
  form.updateFieldAppearances(embedded);
  const saved=await PDFDocument.load(await doc.save());
  assert.equal(saved.getForm().getTextField('clientCompany').getText(),'客戶測試股份有限公司');
});
