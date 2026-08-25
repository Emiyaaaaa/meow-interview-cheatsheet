import { InterviewProvider, useInterview } from "./context/InterviewContext";
import { HomePage } from "./pages/Home";
import { InterviewPage } from "./pages/Interview";

export function App() {
  return (
    <InterviewProvider>
      <AppView />
    </InterviewProvider>
  );
}

function AppView() {
  const { isStarted } = useInterview();
  return isStarted ? <InterviewPage /> : <HomePage />;
}
