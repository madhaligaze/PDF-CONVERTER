"use client";

import { useEffect, useRef, useState } from "react";

import { type Me, financeApi } from "@/components/finance/api";
import { PhoneInput, formatPhone, phoneValue } from "@/components/finance/ui/phone-input";
import { FadeIn } from "@/components/motion/fade-in";
import { SplitReveal } from "@/components/motion/split-reveal";
import { AuthStage, AuthWait } from "@/components/stage/auth-stage";

/**
 * Вход и регистрация раздела «Финансы».
 *
 * Раздел живёт сам по себе: компания регистрируется здесь, а не выдаётся
 * администратором дашборда. Поэтому первый экран — не «введите логин», а выбор
 * между «войти» и «зарегистрировать компанию», и второе стоит не мельче
 * первого: пока компаний мало, регистрация — главное действие экрана.
 *
 * Сотрудники входят по номеру телефона (фронт-план, 6.8): номер → «пароль»
 * или «придумайте пароль». Сервер отвечает «пароль» и на незнакомый номер,
 * поэтому экран для него выглядит так же, как для знакомого: вход не
 * выдаёт, кто зарегистрирован. «Запрос отправлен» — тоже одинаково всегда.
 *
 * Ошибку показываем текстом сервера, а не своим «что-то пошло не так»: сервер
 * различает «неверная почта или пароль», «пароль короче восьми символов» и
 * «почта уже зарегистрирована», и каждое из трёх говорит человеку, что делать.
 */
type Step =
  | "email"
  | "register"
  | "phone"
  | "password"
  | "set"
  | "set-done"
  | "forgot"
  | "forgot-sent"
  | "forgot-email";

const HEADINGS: Record<Step, string> = {
  email: "Вход в учёт компании",
  register: "Регистрация компании",
  phone: "Вход сотрудника",
  password: "Вход сотрудника",
  set: "Придумайте пароль",
  "set-done": "Пароль задан, войдите с ним",
  forgot: "Сброс пароля",
  "forgot-sent": "Запрос отправлен администратору",
  "forgot-email": "Сброс пароля",
};

/** Кто входил по номеру, в следующий раз сразу видит номер. */
const MODE_KEY = "fin_login_mode";

function readMode(): "phone" | "email" {
  try {
    return localStorage.getItem(MODE_KEY) === "phone" ? "phone" : "email";
  } catch {
    return "email";
  }
}

function rememberMode(mode: "phone" | "email") {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* не запомнится — ничего страшного */
  }
}

export function AuthGate({ onReady }: { onReady: (me: Me) => void }) {
  const [step, setStepState] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [againTouched, setAgainTouched] = useState(false);
  const [digits, setDigits] = useState("");
  const [company, setCompany] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [phoneHint, setPhoneHint] = useState("");

  useEffect(() => {
    if (readMode() === "phone") setStepState("phone");
  }, []);

  const setStep = (next: Step) => {
    setStepState(next);
    setError("");
    setPassword("");
    setAgain("");
    setAgainTouched(false);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  const phone = phoneValue(digits);
  const phoneReady = digits.length === 10 && digits[0] === "7";
  const mismatch = again.length > 0 && (againTouched || again.length >= password.length) && again !== password;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    switch (step) {
      case "email":
        return run(async () => {
          const me = await financeApi.login({ email, password });
          rememberMode("email");
          onReady(me);
        });
      case "register":
        return run(async () => onReady(await financeApi.register({ email, password, company, full_name: fullName })));
      case "phone":
        if (!phoneReady) return;
        return run(async () => {
          const { step: next } = await financeApi.phoneStart(phone);
          setStep(next === "set_password" ? "set" : "password");
        });
      case "password":
      case "set-done":
        return run(async () => {
          const me = await financeApi.phoneLogin({ phone, password });
          rememberMode("phone");
          onReady(me);
        });
      case "set":
        if (password !== again) {
          setAgainTouched(true);
          return;
        }
        return run(async () => {
          await financeApi.phoneSetPassword({ phone, password });
          setStep("set-done");
        });
      case "forgot":
        if (!phoneReady) return;
        return run(async () => {
          await financeApi.phoneForgot(phone);
          setStep("forgot-sent");
        });
      case "forgot-sent":
        setStep("phone");
        return;
      case "forgot-email":
        setStep("email");
        return;
    }
  };

  const numberLine = (
    <p className="auth-number">
      <span className="fin-mono">{formatPhone(phone)}</span>
      <button type="button" className="fin-link-btn" onClick={() => setStep("phone")}>
        Изменить
      </button>
    </p>
  );

  return (
    <AuthStage owner="Финансы" title="Учёт денег компании" backHref="/services" backLabel="Сервисы">
      <SplitReveal key={`h-${step}`} as="h2" className="auth-heading" by="words" duration={0.7}>
        {HEADINGS[step]}
      </SplitReveal>

      <FadeIn key={`b-${step}`}>
        <form className="auth-fields" onSubmit={submit} noValidate>
          {step === "register" ? (
            <label className="auth-field">
              <span className="eyebrow">Название компании</span>
              <input
                className="input-field"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder="ТОО «Компания»"
                autoComplete="organization"
                required
              />
            </label>
          ) : null}

          {step === "email" || step === "register" ? (
            <>
              <label className="auth-field">
                <span className="eyebrow">Почта</span>
                <input
                  className="input-field"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="buh@company.kz"
                  autoComplete="email"
                  required
                />
              </label>
              <label className="auth-field">
                <span className="eyebrow">Пароль</span>
                <input
                  className="input-field"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={step === "email" ? "current-password" : "new-password"}
                  required
                />
                {step === "register" ? <span className="auth-hint">От восьми символов.</span> : null}
              </label>
            </>
          ) : null}

          {step === "register" ? (
            <label className="auth-field">
              <span className="eyebrow">Ваше имя (необязательно)</span>
              <input
                className="input-field"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
              />
            </label>
          ) : null}

          {step === "phone" || step === "forgot" ? (
            <label className="auth-field" htmlFor="fin-phone">
              <span className="eyebrow">Телефон</span>
              <PhoneInput
                id="fin-phone"
                value={digits}
                onChange={(next) => {
                  setDigits(next);
                  setError("");
                }}
                autoFocus
                onBlurCheck={setPhoneHint}
                aria-describedby={phoneHint ? "fin-phone-hint" : undefined}
              />
              {phoneHint ? (
                <span id="fin-phone-hint" className="auth-hint fin-fail">
                  {phoneHint}
                </span>
              ) : null}
            </label>
          ) : null}

          {step === "password" || step === "set" || step === "set-done" ? numberLine : null}

          {step === "password" || step === "set-done" ? (
            <PasswordField value={password} onChange={setPassword} autoComplete="current-password" autoFocus />
          ) : null}

          {step === "set" ? (
            <>
              <PasswordField
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                autoFocus
                hint="От восьми символов."
              />
              <label className="auth-field">
                <span className="eyebrow">Ещё раз</span>
                <input
                  className="input-field"
                  type="password"
                  value={again}
                  onChange={(event) => setAgain(event.target.value)}
                  onBlur={() => setAgainTouched(true)}
                  autoComplete="new-password"
                  aria-invalid={mismatch || undefined}
                  aria-describedby={mismatch ? "fin-again-hint" : undefined}
                />
                {mismatch ? (
                  <span id="fin-again-hint" className="auth-hint fin-fail">
                    Пароли не совпадают
                  </span>
                ) : null}
              </label>
            </>
          ) : null}

          {step === "forgot-email" ? (
            <p className="auth-note">
              Пароль администратора сбрасывает владелец компании в личном кабинете. Пароль владельца
              восстанавливается только на сервере.
            </p>
          ) : null}

          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="btn-primary mt-1"
            disabled={
              busy ||
              ((step === "phone" || step === "forgot") && !phoneReady) ||
              (step === "set" && (password.length === 0 || again.length === 0))
            }
          >
            {busy ? "Минуту…" : ACTIONS[step]}
          </button>
        </form>

        <div className="auth-links">
          {step === "email" ? (
            <>
              <button type="button" className="btn-ghost auth-switch" onClick={() => setStep("phone")}>
                Войти как сотрудник
              </button>
              <button type="button" className="fin-link-btn auth-link" onClick={() => setStep("forgot-email")}>
                Забыли пароль?
              </button>
              <button type="button" className="fin-link-btn auth-link" onClick={() => setStep("register")}>
                Регистрация компании
              </button>
            </>
          ) : null}
          {step === "register" ? (
            <button type="button" className="btn-ghost auth-switch" onClick={() => setStep("email")}>
              У меня уже есть учётная запись
            </button>
          ) : null}
          {step === "phone" ? (
            <button
              type="button"
              className="btn-ghost auth-switch"
              onClick={() => {
                rememberMode("email");
                setStep("email");
              }}
            >
              Войти по почте
            </button>
          ) : null}
          {step === "password" ? (
            <button type="button" className="fin-link-btn auth-link" onClick={() => setStep("forgot")}>
              Забыли пароль?
            </button>
          ) : null}
          {step === "forgot" ? (
            <button type="button" className="btn-ghost auth-switch" onClick={() => setStep("phone")}>
              Ко входу
            </button>
          ) : null}
        </div>
      </FadeIn>
    </AuthStage>
  );
}

const ACTIONS: Record<Step, string> = {
  email: "Войти",
  register: "Зарегистрировать компанию",
  phone: "Далее",
  password: "Войти",
  set: "Задать пароль",
  "set-done": "Войти",
  forgot: "Отправить запрос",
  "forgot-sent": "Ко входу",
  "forgot-email": "Ко входу",
};

function PasswordField({
  value,
  onChange,
  autoComplete,
  autoFocus,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
  hint?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // `autoFocus` в форме, которая проявляется, срабатывает раньше, чем поле
  // становится видимым; фокус после кадра надёжнее.
  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);
  return (
    <label className="auth-field">
      <span className="eyebrow">Пароль</span>
      <input
        ref={ref}
        className="input-field"
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required
      />
      {hint ? <span className="auth-hint">{hint}</span> : null}
    </label>
  );
}

/**
 * Экран смены временного пароля.
 *
 * Стоит между входом и разделом: пока пароль временный, сервер отказывает во
 * всём, кроме чтения и самой смены. Показывать вместо этого раздел, в котором
 * ничего не сохраняется, — худший из вариантов.
 */
export function PasswordChangeGate({ onDone }: { onDone: () => void }) {
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await financeApi.changePassword({ old_password: oldPassword, new_password: newPassword });
      onDone();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthStage owner="Финансы" title="Учёт денег компании">
      <h2 className="auth-heading">Смените временный пароль</h2>
      <form className="auth-fields" onSubmit={submit}>
        <label className="auth-field">
          <span className="eyebrow">Временный пароль</span>
          <input
            className="input-field"
            type="password"
            value={oldPassword}
            onChange={(event) => setOld(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label className="auth-field">
          <span className="eyebrow">Новый пароль</span>
          <input
            className="input-field"
            type="password"
            value={newPassword}
            onChange={(event) => setNew(event.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn-primary mt-1" disabled={busy}>
          {busy ? "Меняем…" : "Сменить пароль"}
        </button>
      </form>
    </AuthStage>
  );
}

/**
 * Пока не знаем, вошёл ли человек, показываем не пустоту, а ожидание.
 *
 * Не афишей: следом почти всегда идёт форма входа, и афиша, собранная дважды
 * за полсекунды (сначала здесь, потом в форме), читалась бы как рывок.
 * Подпись проявляется с задержкой — при обычной проверке её не видно вовсе.
 */
export function AuthLoading() {
  return <AuthWait>Проверяем доступ…</AuthWait>;
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const next = await financeApi.me();
        if (alive) setMe(next.authenticated ? next : null);
      } catch {
        if (alive) setMe(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { me, setMe, loading };
}
