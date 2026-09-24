// Uso único: node scripts/create-couple-accounts.mjs /caminho/config-privado.json /caminho/pessoas.json /caminho/credenciais.txt
// pessoas.json: [{"email":"..."}, ...]. O nome é escolhido ao entrar na primeira sala.
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const [configPath, peoplePath, outputPath] = process.argv.slice(2);
if (!configPath || !peoplePath || !outputPath) throw new Error('Informe os três caminhos.');
const { url, publicKey, serviceKey } = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const people = JSON.parse(fs.readFileSync(peoplePath, 'utf8'));
if (!Array.isArray(people) || people.length !== 2 ||
  people.some(person => !person.email)) {
  throw new Error('Informe exatamente duas pessoas com email.');
}
if (fs.existsSync(outputPath)) throw new Error('O arquivo de credenciais já existe; não vou sobrescrevê-lo.');

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const credentials = [];
for (const person of people) {
  const password = randomBytes(21).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({
    email: person.email.trim(),
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Não foi possível criar ${person.email}: ${error?.message || 'sem usuário'}`);
  const client = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: loginError } = await client.auth.signInWithPassword({ email: person.email.trim(), password });
  if (loginError) throw new Error(`Conta criada, mas login falhou para ${person.email}: ${loginError.message}`);
  credentials.push({ email: person.email.trim(), password });
  fs.writeFileSync(outputPath, credentials.map(item => `${item.email}\n${item.password}\n`).join('\n'), { mode: 0o600 });
  console.log(`Conta ${credentials.length}/2 criada e login testado.`);
}
console.log(`Credenciais salvas apenas em ${outputPath}.`);
