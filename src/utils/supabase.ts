import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ulofnfufonyafxefinxf.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsb2ZuZnVmb255YWZ4ZWZpbnhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MjU4NzksImV4cCI6MjA5ODEwMTg3OX0.qSlpNHR1-e0VmZIYHzxnGc1iUP-hq_085ypcaLSF5Uo';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
