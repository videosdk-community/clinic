import { Navigate, Route, Routes } from 'react-router-dom'
import { SignIn } from './screens/SignIn'
import { AuthCallback } from './screens/AuthCallback'
import { Dashboard } from './screens/Dashboard'
import { VisitDetails } from './screens/VisitDetails'
import { JoinRoute } from './screens/JoinRoute'
import { RequireAuth } from './auth/RequireAuth'

/* Routes.

   /                 the doctor's dashboard: new visit, upcoming, ended
   /visits/:roomId   one visit: consent and recordings
   /signin           doctor magic link
   /auth/callback    where the link lands
   /v/:roomId        the one way into a visit, doctor and patient alike

   The visit URL carries no role. It comes from api/session.ts, which derives
   it from who owns the visit. /v/ is not behind RequireAuth: a patient signs
   in anonymously on that page by typing a name. */

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/visits/:roomId"
        element={
          <RequireAuth>
            <VisitDetails />
          </RequireAuth>
        }
      />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/v/:roomId" element={<JoinRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
