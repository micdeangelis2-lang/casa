"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bootstrapAction, type BootstrapFormState } from "./actions";

const initialState: BootstrapFormState = {};

export function BootstrapForm() {
  const t = useTranslations("auth.bootstrap");
  const [state, formAction, pending] = useActionState(bootstrapAction, initialState);
  const fieldError = (field: string) => state.fieldErrors?.[field]?.[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("title")}</h1>
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          {state.error ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${state.error}`)}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="name">{t("name")}</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              required
              defaultValue={state.values?.name}
              aria-invalid={Boolean(fieldError("name"))}
              aria-describedby={fieldError("name") ? "name-error" : undefined}
            />
            {fieldError("name") ? (
              <p id="name-error" className="text-sm text-destructive">
                {fieldError("name")}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              defaultValue={state.values?.email}
              aria-invalid={Boolean(fieldError("email"))}
              aria-describedby={fieldError("email") ? "email-error" : undefined}
            />
            {fieldError("email") ? (
              <p id="email-error" className="text-sm text-destructive">
                {fieldError("email")}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              aria-invalid={Boolean(fieldError("password"))}
              aria-describedby={fieldError("password") ? "password-error password-hint" : "password-hint"}
            />
            <p id="password-hint" className="text-sm text-muted-foreground">
              {t("passwordHint")}
            </p>
            {fieldError("password") ? (
              <p id="password-error" className="text-sm text-destructive">
                {fieldError("password")}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="token">{t("token")}</Label>
            <Input
              id="token"
              name="token"
              type="password"
              autoComplete="off"
              required
              aria-invalid={Boolean(fieldError("token"))}
              aria-describedby={fieldError("token") ? "token-error" : undefined}
            />
            {fieldError("token") ? (
              <p id="token-error" className="text-sm text-destructive">
                {fieldError("token")}
              </p>
            ) : null}
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
