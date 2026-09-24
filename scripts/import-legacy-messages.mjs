// Uso administrativo após aplicar a migração num projeto novo:
// WEBCHAT_TARGET_SUPABASE_URL=... WEBCHAT_TARGET_SERVICE_ROLE_KEY=... \
// WEBCHAT_LEGACY_BACKUP=/caminho/backup.jsonl node scripts/import-legacy-messages.mjs
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const config = process.env.WEBCHAT_TARGET_CONFIG_FILE
  ? JSON.parse(fs.readFileSync(process.env.WEBCHAT_TARGET_CONFIG_FILE, 'utf8'))
  : {};
const url = process.env.WEBCHAT_TARGET_SUPABASE_URL || config.url;
const key = process.env.WEBCHAT_TARGET_SERVICE_ROLE_KEY || config.serviceKey;
const backup = process.env.WEBCHAT_LEGACY_BACKUP;
if (!url || !key || !backup) {
  throw new Error('Informe WEBCHAT_TARGET_SUPABASE_URL, WEBCHAT_TARGET_SERVICE_ROLE_KEY e WEBCHAT_LEGACY_BACKUP.');
}

const rows = fs.readFileSync(backup, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const ids = new Set(rows.map((row) => row.id));
if (ids.size !== rows.length) throw new Error('O backup tem IDs duplicados. Importação interrompida.');
if (rows.some((row) => !row.id || !row.room || !row.author || typeof row.content !== 'string' || !row.created_at)) {
  throw new Error('O backup contém mensagens incompletas. Importação interrompida.');
}

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
let imported = 0;
for (let start = 0; start < rows.length; start += 25) {
  const batch = rows.slice(start, start + 25);
  const { error } = await client.from('messages_chat').upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw new Error(`Lote ${start / 25 + 1}: ${error.message}`);
  imported += batch.length;
}

const { count, error } = await client.from('messages_chat').select('id', { count: 'exact', head: true });
if (error) throw error;
if (count < ids.size) throw new Error(`Importação incompleta: backup ${ids.size}, banco ${count}.`);
console.log(`Backup enviado: ${imported} mensagens. Banco de destino: ${count} mensagens.`);
