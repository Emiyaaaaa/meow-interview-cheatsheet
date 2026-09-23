import { Toast } from "@heroui/react";
import { AuthProvider } from "./context/AuthContext";
import { InterviewProvider, useInterview } from "./context/InterviewContext";
import { isMockInterviewWindow } from "./mockInterviewWindow";
import { isOverlayWindow } from "./overlayWindow";
import { BindPhoneModal } from "./components/BindPhoneModal";
import { HomePage } from "./pages/Home";
import { InterviewPage, OverlayInterviewPage } from "./pages/Interview";
import { MockInterviewSessionPage } from "./pages/MockInterviewSession";

export function App() {
  if (isOverlayWindow()) {
    return <OverlayInterviewPage />;
  }

  if (isMockInterviewWindow()) {
    return (
      <AuthProvider>
        <Toast.Provider placement="top" />
        <MockInterviewSessionPage />
        <BindPhoneModal />
      </AuthProvider>
    );
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
  return (
    <>
      {isStarted ? <InterviewPage /> : <HomePage />}
      <BindPhoneModal />
    </>
  );
}
