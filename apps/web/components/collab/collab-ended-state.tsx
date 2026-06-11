import { CircleSlash2 } from "lucide-react";

type Props = {
  title?: string;
  description?: string;
};

export function CollabEndedState({
  title = "协作已结束",
  description = "作者已结束本次协作，请联系对方重新邀请。",
}: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-xl border bg-background p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <CircleSlash2 className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="mt-4 text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
