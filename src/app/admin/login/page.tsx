export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Chinatown Cool Corners</h1>
        <p className="mt-1 text-sm text-neutral-600">Admin access</p>
      </div>
      {error ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          Wrong passcode. Try again.
        </p>
      ) : null}
      <form action="/api/auth/admin" method="POST" className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next ?? "/admin"} />
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Admin passcode</span>
          <input
            type="password"
            name="passcode"
            inputMode="text"
            autoComplete="off"
            autoFocus
            required
            className="h-14 rounded-lg border border-neutral-300 px-4 text-lg"
          />
        </label>
        <button
          type="submit"
          className="h-14 rounded-lg bg-neutral-900 text-lg font-semibold text-white active:bg-neutral-700"
        >
          Enter
        </button>
      </form>
    </main>
  );
}
