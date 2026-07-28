import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import HomePage from "./pages/HomePage";

function SavedResumeRoute() {
  const { id } = useParams<{ id: string }>();
  return <HomePage autoLoadId={id} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        {/* Deep link to auto-load a resume saved on this browser, e.g. from
            the "Copy link" button next to a saved Harnon ID. */}
        <Route path="/r/:id" element={<SavedResumeRoute />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  );
}
