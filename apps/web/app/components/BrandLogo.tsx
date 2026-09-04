type BrandLogoProps = {
  className?: string;
};

export default function BrandLogo({ className = 'h-12 w-auto' }: BrandLogoProps) {
  return (
    <img
      src="/drapixai_wordmark.webp"
      alt="DrapixAI"
      width={176}
      height={59}
      className={`object-contain ${className}`}
    />
  );
}
