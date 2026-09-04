import { AuthProvider } from "./context/AuthContext";
import { InterviewProvider, useInterview } from "./context/InterviewContext";
import { isOverlayWindow } from "./overlayWindow";
import { HomePage } from "./pages/Home";
import { InterviewPage, OverlayInterviewPage } from "./pages/Interview";

export function App() {
  if (isOverlayWindow()) {
    return <OverlayInterviewPage />;
  }

  return (
    <AuthProvider>
      <InterviewProvider>
        <AppView />
      </InterviewProvider>
    </AuthProvider>
  );
}

function AppView() {
  const { isStarted } = useInterview();
  return isStarted ? <InterviewPage /> : <HomePage />;
}
