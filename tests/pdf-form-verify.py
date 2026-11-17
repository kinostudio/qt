from pathlib import Path
from pypdf import PdfReader, PdfWriter

for source in Path('tmp/pdfs').glob('client-form-*.pdf'):
    if source.stem.endswith('-filled'):
        continue
    reader = PdfReader(source)
    fields = reader.get_fields()
    assert set(fields) == {'clientCompany', 'clientContact', 'clientTaxId', 'clientPhone'}
    widgets = [a.get_object() for p in reader.pages for a in p.get('/Annots', []) if a.get_object().get('/Subtype') == '/Widget']
    assert len(widgets) == 4
    assert all(w.get('/AP', {}).get('/N') for w in widgets)
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    values = {'clientCompany': '甲方測試有限公司', 'clientContact': '王小明', 'clientTaxId': '12345678', 'clientPhone': '0912345678'}
    writer.update_page_form_field_values(None, values, auto_regenerate=False)
    output = source.with_stem(source.stem+'-filled')
    writer.write(output)
    saved = PdfReader(output)
    assert all(saved.get_fields()[k]['/V'] == v for k, v in values.items())
    for p in saved.pages:
        for ref in p.get('/Annots', []):
            w = ref.get_object()
            parent = w.get('/Parent')
            if parent:
                field = parent.get_object()
                assert field['/V'] == values[field['/T']]
    print('PASS canonical values, widgets, appearances and Chinese round-trip:', source.name)
