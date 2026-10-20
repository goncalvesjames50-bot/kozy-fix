import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const jsonHeaders = { "Content-Type": "application/json" };

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function hashLicenseKey(key: string): Promise<string> {
  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async request => {
  if (request.method !== "POST") {
    return jsonResponse(405, { valid: false, status: "method_not_allowed", message: "Método não permitido." });
  }

  let body: { key?: unknown; deviceId?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { valid: false, status: "invalid_request", message: "Pedido inválido." });
  }

  if (
    typeof body.key !== "string" ||
    typeof body.deviceId !== "string" ||
    !/^PF-[A-F0-9]{48}$/i.test(body.key.trim()) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.deviceId)
  ) {
    return jsonResponse(400, { valid: false, status: "invalid_request", message: "Chave ou identificador do computador inválido." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Faltam SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nos segredos da função.");
    return jsonResponse(500, { valid: false, status: "server_configuration_error", message: "O serviço de licenças está mal configurado." });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const keyHash = await hashLicenseKey(body.key.trim().toUpperCase());
  const { data: license, error: lookupError } = await supabase
    .from("license_keys")
    .select("id, active, device_id")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (lookupError) {
    console.error("Falha ao consultar a licença:", lookupError.message);
    return jsonResponse(500, { valid: false, status: "server_error", message: "Não foi possível consultar a licença. Tenta novamente mais tarde." });
  }
  if (!license) {
    return jsonResponse(401, { valid: false, status: "invalid_key", message: "A chave de licença não é válida." });
  }
  if (!license.active) {
    return jsonResponse(403, { valid: false, status: "revoked", message: "Esta licença foi desativada. Contacta o suporte." });
  }
  if (license.device_id && license.device_id !== body.deviceId) {
    return jsonResponse(403, { valid: false, status: "device_bound", message: "Esta chave já está associada a outro computador." });
  }

  if (!license.device_id) {
    const { data: boundLicense, error: bindError } = await supabase
      .from("license_keys")
      .update({ device_id: body.deviceId, activated_at: new Date().toISOString() })
      .eq("id", license.id)
      .eq("active", true)
      .is("device_id", null)
      .select("device_id")
      .maybeSingle();

    if (bindError) {
      console.error("Falha ao associar a licença ao computador:", bindError.message);
      return jsonResponse(500, { valid: false, status: "server_error", message: "Não foi possível ativar a licença. Tenta novamente mais tarde." });
    }
    if (boundLicense?.device_id !== body.deviceId) {
      const { data: latestLicense, error: latestError } = await supabase
        .from("license_keys")
        .select("active, device_id")
        .eq("id", license.id)
        .maybeSingle();

      if (latestError) {
        console.error("Falha ao confirmar a associação da licença:", latestError.message);
        return jsonResponse(500, { valid: false, status: "server_error", message: "Não foi possível confirmar a licença. Tenta novamente mais tarde." });
      }
      if (!latestLicense?.active) {
        return jsonResponse(403, { valid: false, status: "revoked", message: "Esta licença foi desativada. Contacta o suporte." });
      }
      if (latestLicense.device_id !== body.deviceId) {
        return jsonResponse(403, { valid: false, status: "device_bound", message: "Esta chave já está associada a outro computador." });
      }
    }
  }

  return jsonResponse(200, { valid: true, status: "active", message: "Licença ativada com sucesso." });
});
