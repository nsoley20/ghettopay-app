const SUPA_URL = 'https://qzazkxlamuylurhjquzu.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6YXpreGxhbXV5bHVyaGpxdXp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNjM0NzYsImV4cCI6MjA4OTgzOTQ3Nn0.ow7l6dQZqsl5j8UFMrMY0JgIWR65gBFuMLn6MdI7SzQ';

export const db = window.supabase.createClient(SUPA_URL, SUPA_KEY);
