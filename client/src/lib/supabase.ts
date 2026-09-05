import { createClient } from '@supabase/supabase-js';

// Frontend uses the ANON key only (never the service role key) - RLS
// policies in supabase/schema.sql govern what this client can actually do.
// Used here just for direct Storage uploads (photos); auth and DB writes
// go through the backend API so the httpOnly cookie stays in control.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function uploadReportPhoto(file: File): Promise<string> {
  const ext = file.name.split('.').pop();
  const path = `reports/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from('report-photos').upload(path, file);
  if (error) throw error;

  const { data } = supabase.storage.from('report-photos').getPublicUrl(path);
  return data.publicUrl;
}
