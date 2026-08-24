// ============================================================
//  CONFIGURACIÓN DE SUPABASE
// ============================================================
//  Acá pegás las 2 claves de tu proyecto de Supabase.
//  El README.md te explica paso a paso de dónde sacarlas.
//
//  ¿Es seguro que esta clave quede pública en GitHub?
//  SÍ. La "anon key" (clave anónima) está diseñada para ir en
//  el navegador. No da acceso de administrador. La seguridad
//  la controlan las "policies" que creás en Supabase con el
//  archivo supabase_setup.sql.
//
//  Reemplazá los dos textos entre comillas de abajo:
// ============================================================

window.CONFIG = {
  // 1) La URL de tu proyecto.
  SUPABASE_URL: "https://yctambughgkuoxamuuqj.supabase.co",

  // 2) La clave pública (publishable). Segura de compartir.
  SUPABASE_ANON_KEY: "sb_publishable_OdS_gWXbYaipCYivK3rY9w_RbdmYNos",

  // 3) Sistema de usuarios (login con mail + contraseña).
  //    Dejalo en false hasta terminar los pasos de Supabase del README
  //    (crear los usuarios, correr supabase_auth_setup.sql y configurar
  //    la URL del sitio). Cuando esté todo listo, ponelo en true.
  AUTH_ENABLED: false,
};
