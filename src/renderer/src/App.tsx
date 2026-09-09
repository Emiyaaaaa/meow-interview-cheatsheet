import { Toast } from "@heroui/react";
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
        <Toast.Provider placement="top" />
        <AppView />
      </InterviewProvider>
    </AuthProvider>
  );
}

function AppView() {
  const { isStarted } = useInterview();
  return isStarted ? <InterviewPage /> : <HomePage />;
}
