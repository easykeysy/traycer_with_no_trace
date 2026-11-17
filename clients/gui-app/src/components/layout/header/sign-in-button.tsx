import type { SignInLayout } from "./types";

export interface SignInButtonProps {
  readonly layout: SignInLayout;
}

/**
 * Fork (no-account): the upstream account system is removed. The app boots
 * into a local, account-free session, so there is no sign-in surface to
 * render anywhere (header, side strip, landing hero). The component is kept
 * as a no-op so every call site keeps compiling; the `AuthService` device
 * flow underneath stays intact for the link-code deep path.
 */
export function SignInButton(_props: SignInButtonProps): null {
  return null;
}
