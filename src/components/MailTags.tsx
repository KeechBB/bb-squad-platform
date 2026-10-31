import { mailTagLabel, mailTagTone } from "@/lib/mailTags";

export function MailTags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span className="mail-tags">
      {tags.map((tag) => (
        <span key={tag} className={`mail-tag is-${mailTagTone(tag)}`}>
          {mailTagLabel(tag)}
        </span>
      ))}
    </span>
  );
}
