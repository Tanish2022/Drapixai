type BrandLogoProps = {
  className?: string;
};

export default function BrandLogo({ className = 'h-12 w-auto' }: BrandLogoProps) {
  return (
    <img
      src="/drapixai_wordmark.webp?v=20261031-source"
      alt="DrapixAI"
      width={176}
      height={59}
      className={`object-contain mix-blend-darken ${className}`}
    />
  );
}
