export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main id="main" className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 p-4">
      {children}
    </main>
  );
}
