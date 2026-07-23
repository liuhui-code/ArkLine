import { englishQueryInputProps } from "@/components/layout/query-input-props";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import { useSearchSessionInput } from "@/components/layout/use-search-session-input";

type SearchSessionQueryInputProps = {
  label: string;
  mode: SearchEverywhereMode;
  query: string;
  placeholder: string;
  onDraftChange: (query: string) => void;
  onCommit: (query: string) => void;
};

export function SearchSessionQueryInput({
  label,
  mode,
  query,
  placeholder,
  onDraftChange,
  onCommit,
}: SearchSessionQueryInputProps) {
  const { inputRef, updateDraftQuery } = useSearchSessionInput(query, mode, onCommit);

  return (
    <input
      ref={inputRef}
      aria-label={label}
      autoFocus
      className="panel-input"
      {...englishQueryInputProps}
      defaultValue={query}
      placeholder={placeholder}
      onChange={(event) => {
        const nextQuery = event.target.value;
        updateDraftQuery(nextQuery);
        onDraftChange(nextQuery);
      }}
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
          event.preventDefault();
        }
      }}
    />
  );
}
