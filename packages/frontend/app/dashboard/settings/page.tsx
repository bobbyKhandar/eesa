"use client"

import { SignInButton, UserProfile, useUser } from "@clerk/nextjs"
import { Button } from "@/frontend/components/ui/button"

export default function SettingsPage() {
  const { isLoaded, isSignedIn } = useUser()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Account Settings</h1>
        <p className="text-muted-foreground">Manage your profile, photo, sign-in methods, and account security.</p>
      </div>
      {!isLoaded ? <p role="status">Loading account settings...</p> : isSignedIn ? (
        <div className="max-w-full overflow-x-auto">
          <UserProfile routing="hash" />
        </div>
      ) : (
        <div className="space-y-3">
          <p>Sign in to manage your account.</p>
          <SignInButton mode="modal"><Button>Sign in</Button></SignInButton>
        </div>
      )}
    </div>
  )
}
