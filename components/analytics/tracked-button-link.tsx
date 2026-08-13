"use client";

import { ButtonLink } from "@/components/ui/button";
import { trackEvent, type AnalyticsEvent } from "@/lib/analytics/track";

type ButtonLinkProps = React.ComponentProps<typeof ButtonLink>;

interface TrackedButtonLinkProps extends ButtonLinkProps {
  event: AnalyticsEvent;
  eventProps?: Record<string, string | number | boolean | undefined>;
}

export function TrackedButtonLink({ event, eventProps, onClick, ...props }: TrackedButtonLinkProps) {
  return (
    <ButtonLink
      {...props}
      onClick={(clickEvent) => {
        trackEvent(event, eventProps);
        onClick?.(clickEvent);
      }}
    />
  );
}
