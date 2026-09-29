"use client"

// Boring UI registry: conflict-banner. Shown when a save was refused because the file changed since it was read
// (VIEWERS-5). The person decides: reload (discard theirs), overwrite (keep theirs, over the version they now saw),
// or keep editing. Nothing is overwritten without that choice.
import { TriangleAlert } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export type ConflictBannerProps = {
  /** The revision the file is at now, when the provider said. */
  current?: string | null
  onReload: () => void | Promise<unknown>
  onOverwrite: () => void | Promise<unknown>
  onDismiss?: () => void
  className?: string
}

export function ConflictBanner({ current, onReload, onOverwrite, onDismiss, className }: ConflictBannerProps) {
  return (
    <Alert role="alert" data-boring="conflict" variant="destructive" className={className}>
      <TriangleAlert />
      <AlertTitle>This file changed since you opened it</AlertTitle>
      <AlertDescription>
        <p>Someone (or the agent) saved a newer version{current ? ` (revision ${current})` : ""}. Your edits are kept here until you choose.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void onReload()}>Reload theirs</Button>
          <Button size="sm" variant="destructive" onClick={() => void onOverwrite()}>Overwrite with mine</Button>
          {onDismiss && <Button size="sm" variant="ghost" onClick={onDismiss}>Keep editing</Button>}
        </div>
      </AlertDescription>
    </Alert>
  )
}
