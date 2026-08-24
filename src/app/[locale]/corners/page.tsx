import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getPublicCorners } from "@/lib/public-corners";
import type { Locale } from "@/i18n/routing";

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "corners" });
  return { title: t("heading") };
}

export default async function CornersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("corners");

  const corners = await getPublicCorners(locale as Locale).catch(() => []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold">{t("heading")}</h1>
      <p className="mt-3 text-lg leading-relaxed">{t("intro")}</p>

      {corners.length === 0 ? (
        <p className="mt-8 rounded-lg border border-neutral-200 p-4 text-neutral-700">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-6">
          {corners.map((corner) => (
            <li key={corner.id} className="rounded-xl border border-neutral-200 p-5">
              <h2 className="text-2xl font-semibold">{corner.name}</h2>
              {corner.description ? (
                <p className="mt-2 leading-relaxed">{corner.description}</p>
              ) : null}
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-700">
                {corner.hasSeating ? (
                  <div>
                    <dt className="inline font-medium">{t("seating")}</dt>
                  </div>
                ) : null}
                {corner.installedOn ? (
                  <div>
                    <dt className="inline font-medium">{t("installed")}: </dt>
                    <dd className="inline">
                      {new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
                        new Date(corner.installedOn),
                      )}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {corner.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={corner.photoUrl}
                  alt={corner.name}
                  loading="lazy"
                  className="mt-4 w-full rounded-lg object-cover"
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
