// app/admin/layout.tsx — pass-through layout for /admin/*.
//
// The auth-checking admin shell lives in app/admin/(shell)/layout.tsx.
// This split ensures /admin/login is NOT wrapped by the auth-checking
// layout (which would cause a redirect loop: login page → auth() null →
// redirect to /admin/login → loop). Route groups (shell) and the login
// directory are siblings under app/admin/, so this pass-through applies
// to both, but only (shell) gets the nested auth-checking layout.
export default function AdminPassthroughLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
