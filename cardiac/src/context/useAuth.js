import { useContext } from "react";

import { AuthContext } from "./authContextObject";

/*
Lives in its own file so AuthContext.jsx only exports a
component. Mixing component and non-component exports in
one file breaks React Fast Refresh during development.
*/
export const useAuth = () => useContext(AuthContext);
