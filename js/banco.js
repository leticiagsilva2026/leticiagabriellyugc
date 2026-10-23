/* =====================================================================
   LIGAÇÃO COM O SUPABASE (usado pelo portfólio, pelo login e pelo painel)

   Aqui ficam só o endereço do projeto e a chave PÚBLICA (publishable).
   Essa chave pode ficar à mostra: quem protege os dados é a tranca (RLS)
   que está no banco.sql. Nunca coloque a chave secreta (service_role) aqui.
   ===================================================================== */
window.BANCO_URL = "https://crnufheiqzbonuuqtdch.supabase.co";
window.BANCO_CHAVE = "sb_publishable_8dZcK-96ThkE39Woyrpgyw_w96r_CS4";

/* Cria a conexão. Se a biblioteca do Supabase não carregar (internet fora, por exemplo),
   window.banco fica vazio e cada página segue funcionando do jeito dela. */
window.banco = null;
try {
  if (window.supabase && typeof window.supabase.createClient === "function") {
    window.banco = window.supabase.createClient(window.BANCO_URL, window.BANCO_CHAVE);
  }
} catch (erro) {
  window.banco = null;
}
