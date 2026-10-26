import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  firebaseConfigured,
  firebaseInitializationError,
  missingFirebaseKeys,
} from "./firebase/firebase";
import StartupNotice from "./components/StartupNotice";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("The application root element was not found.");
}

const root = ReactDOM.createRoot(rootElement);

if (import.meta.hot) {
  import.meta.hot.dispose(() => root.unmount());
}

if (firebaseInitializationError) {
  console.error("Firebase could not initialize:", firebaseInitializationError);
  root.render(
    <StartupNotice title="Firebase could not initialize">
      <p>
        Check the web-app values in <code>cardiac/.env</code> against the
        authorized Firebase project, then restart Vite.
      </p>
      <p>See the browser console for the initialization error.</p>
    </StartupNotice>
  );
} else if (!firebaseConfigured) {
  root.render(
    <StartupNotice title="Firebase configuration required">
      <p>
        The app needs the authorized Firebase web-app configuration before
        authentication and patient data can load.
      </p>
      <p>
        Copy <code>cardiac/.env.example</code> to <code>cardiac/.env</code>,
        then fill in these values from the Firebase project owner:
      </p>
      <ul>
        {missingFirebaseKeys.map((key) => (
          <li key={key}>
            <code>VITE_FIREBASE_{key.replace(/[A-Z]/g, (letter) =>
              `_${letter}`
            ).toUpperCase()}</code>
          </li>
        ))}
      </ul>
      <p>
        Get the values from Firebase Console → Project settings → General →
        Your apps → the authorized web app. Confirm the intended project with
        its owner; do not rely on the repository&apos;s Firebase CLI alias.
        Restart Vite after saving the file.
      </p>
    </StartupNotice>
  );
} else {
  import("./App")
    .then(({ default: App }) => {
      root.render(
        <BrowserRouter>
          <App />
        </BrowserRouter>
      );
    })
    .catch((error) => {
      console.error("CardioCare failed to load:", error);
      root.render(
        <StartupNotice title="CardioCare could not start">
          <p>
            The application encountered a startup error. Check the browser
            console for details and try again after resolving the error.
          </p>
        </StartupNotice>
      );
    });
}