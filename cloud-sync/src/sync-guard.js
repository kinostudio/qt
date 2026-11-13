// A failing SELECT aborts the entire D1 batch, including later deletes.
export const tables = {projects:'cloud_projects', templates:'cloud_contract_templates', categories:'cloud_clause_categories', clauses:'cloud_clauses', stamps:'cloud_stamp_assets'};
export function guardSql(key) {
  const table = tables[key];
  const active = key === 'stamps' ? ' AND r.deleted_at IS NULL' : '';
  const children = key === 'categories' ? ` OR EXISTS (
    SELECT c.id,c.updated_at FROM cloud_clauses c WHERE c.workspace_id=?1 AND c.category_id=d.value
    EXCEPT SELECT j.key,j.value FROM json_each(e.value,'$.children') j
  ) OR EXISTS (
    SELECT j.key,j.value FROM json_each(e.value,'$.children') j EXCEPT
    SELECT c.id,c.updated_at FROM cloud_clauses c WHERE c.workspace_id=?1 AND c.category_id=d.value
  )` : '';
  return `SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(?2) d LEFT JOIN json_each(?3) e ON e.key=d.value
    LEFT JOIN ${table} r ON r.workspace_id=?1 AND r.id=d.value${active}
    WHERE e.key IS NULL OR r.updated_at IS NOT json_extract(e.value,'$.updatedAt') ${children}
  ) THEN json('sync conflict') ELSE 1 END`;
}
