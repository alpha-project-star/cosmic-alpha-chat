// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, waitFor, cleanup } from '@testing-library/react';
import * as firebaseAuth from 'firebase/auth';
import {
  _resetAuthBootstrapForTesting,
  ensureAuthenticatedUser,
  AuthProvider,
  useAuth,
} from '../src/lib/auth';

vi.mock('firebase/auth', () => {
  let currentUser: any = null;
  let authListener: ((user: any) => void) | null = null;

  return {
    getAuth: vi.fn(() => ({
      get currentUser() {
        return currentUser;
      },
      set currentUser(u: any) {
        currentUser = u;
      },
    })),
    onAuthStateChanged: vi.fn((_auth, callback) => {
      authListener = callback;
      return () => {
        authListener = null;
      };
    }),
    signInAnonymously: vi.fn(),
    __setMockUser: (user: any) => {
      currentUser = user;
    },
    __triggerAuthState: (user: any) => {
      currentUser = user;
      if (authListener) authListener(user);
    },
    __getAuthListener: () => authListener,
  };
});

function TestConsumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      {auth.status === 'authenticated' && <span data-testid="uid">{auth.user.uid}</span>}
      {auth.status === 'error' && <span data-testid="error">{auth.error.message}</span>}
    </div>
  );
}

describe('Authentication Bootstrap & Anonymous Auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetAuthBootstrapForTesting();
    (firebaseAuth as any).__setMockUser(null);
  });

  afterEach(() => {
    cleanup();
  });

  it('1. Returns currentUser immediately if already present in ensureAuthenticatedUser', async () => {
    const mockUser = { uid: 'user-already-authed' };
    (firebaseAuth as any).__setMockUser(mockUser);

    const user = await ensureAuthenticatedUser();
    expect(user).toEqual(mockUser);
    expect(firebaseAuth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('2. Automatically triggers signInAnonymously when initialized with null user', async () => {
    const anonUser = { uid: 'anon-uid-100', isAnonymous: true };
    vi.mocked(firebaseAuth.signInAnonymously).mockResolvedValueOnce({
      user: anonUser as any,
    } as any);

    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Initial state is loading
    expect(getByTestId('status').textContent).toBe('loading');

    // Simulate onAuthStateChanged firing with null user (unauthenticated on start)
    await act(async () => {
      const listener = (firebaseAuth as any).__getAuthListener();
      expect(listener).toBeDefined();
      await listener(null);
    });

    expect(firebaseAuth.signInAnonymously).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(getByTestId('status').textContent).toBe('authenticated');
      expect(getByTestId('uid').textContent).toBe('anon-uid-100');
    });
  });

  it('3. Deduplicates multiple renders and does not call signInAnonymously repeatedly', async () => {
    const anonUser = { uid: 'anon-uid-dedup', isAnonymous: true };
    vi.mocked(firebaseAuth.signInAnonymously).mockResolvedValueOnce({
      user: anonUser as any,
    } as any);

    const { getByTestId, rerender } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await act(async () => {
      const listener = (firebaseAuth as any).__getAuthListener();
      await listener(null);
    });

    // Re-render
    rerender(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(firebaseAuth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('4. Reports actionable message when anonymous sign-in is disabled in Firebase Console', async () => {
    const consoleDisabledError: any = new Error('Operation not allowed');
    consoleDisabledError.code = 'auth/operation-not-allowed';
    vi.mocked(firebaseAuth.signInAnonymously).mockRejectedValueOnce(consoleDisabledError);

    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await act(async () => {
      const listener = (firebaseAuth as any).__getAuthListener();
      await listener(null);
    });

    await waitFor(() => {
      expect(getByTestId('status').textContent).toBe('error');
      expect(getByTestId('error').textContent).toContain('Anonymous sign-in is disabled in the Firebase Console');
    });
  });
});
