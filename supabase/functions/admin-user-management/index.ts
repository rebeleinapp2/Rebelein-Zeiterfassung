// Supabase Edge Function: Admin User Management
// Handles: Change Password, Delete User
// Security: Only admin users can call these actions

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // 1. Verify the calling user is an admin
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        // Create a client with the user's JWT to verify identity
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } }
        })

        // Get the calling user
        const { data: { user: callingUser }, error: authError } = await userClient.auth.getUser()
        if (authError || !callingUser) {
            return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        // Check if the calling user is admin
        const { data: callerSettings, error: settingsError } = await userClient
            .from('user_settings')
            .select('role')
            .eq('user_id', callingUser.id)
            .single()

        if (settingsError || !callerSettings || callerSettings.role !== 'admin') {
            return new Response(JSON.stringify({ error: 'Nur Administratoren können diese Aktion ausführen' }), {
                status: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        // 2. Parse the request
        const { action, targetUserId, newPassword } = await req.json()

        if (!action || !targetUserId) {
            return new Response(JSON.stringify({ error: 'Fehlende Parameter' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        // Prevent admin from deleting themselves
        if (action === 'delete' && targetUserId === callingUser.id) {
            return new Response(JSON.stringify({ error: 'Du kannst dich nicht selbst löschen' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        // Create admin client with service_role key
        const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })

        // 3. Execute action
        if (action === 'change_password') {
            if (!newPassword || newPassword.length < 6) {
                return new Response(JSON.stringify({ error: 'Das Passwort muss mindestens 6 Zeichen lang sein' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                })
            }

            const { error: updateError } = await adminClient.auth.admin.updateUserById(targetUserId, {
                password: newPassword
            })

            if (updateError) {
                return new Response(JSON.stringify({ error: `Fehler beim Ändern des Passworts: ${updateError.message}` }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                })
            }

            return new Response(JSON.stringify({ success: true, message: 'Passwort erfolgreich geändert' }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })

        } else if (action === 'delete') {
            // First, soft-delete or clean up user data
            // Mark user_settings as inactive
            await adminClient
                .from('user_settings')
                .update({ is_active: false })
                .eq('user_id', targetUserId)

            // Delete the auth user
            const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId)

            if (deleteError) {
                return new Response(JSON.stringify({ error: `Fehler beim Löschen des Benutzers: ${deleteError.message}` }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                })
            }

            return new Response(JSON.stringify({ success: true, message: 'Benutzer erfolgreich gelöscht' }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })

        } else {
            return new Response(JSON.stringify({ error: `Unbekannte Aktion: ${action}` }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

    } catch (err) {
        return new Response(JSON.stringify({ error: `Serverfehler: ${(err as Error).message}` }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }
})
