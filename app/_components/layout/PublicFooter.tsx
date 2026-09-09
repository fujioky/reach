import { ReachMark } from '@/app/_components/brand/ReachMark';
import { SiteMetaLinks } from '@/app/_components/layout/SiteMetaLinks';

export function PublicFooter({
  note = '仅供私人小范围分享',
}: {
  note?: string;
}) {
  return (
    <footer className="mt-auto border-t border-border px-6 py-8 md:px-14">
      <div className="mx-auto flex max-w-[1120px] flex-col items-center justify-between gap-4 sm:flex-row">
        <span className="flex items-center gap-2">
          <ReachMark size={20} className="text-brand" />
          <span className="font-display text-base font-bold text-ink">Reach</span>
        </span>
        <div className="flex flex-col items-center gap-2 text-xs text-muted sm:flex-row sm:gap-5">
          <span>{note}</span>
          <SiteMetaLinks />
        </div>
      </div>
    </footer>
  );
}