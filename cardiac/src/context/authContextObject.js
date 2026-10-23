import { createContext } from "react";

/*
The context object lives in its own module so that
AuthContext.jsx exports only a component. Mixing a
component export with a non-component export in one file
breaks React Fast Refresh during development.
*/
export const AuthContext = createContext({
  user: null,
  role: null,
  loading: true,
  logout: async () => {},
});
