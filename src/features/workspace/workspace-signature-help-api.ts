export type LanguageSignatureHelpParameter = {
  label: string;
  documentation?: string;
};

export type LanguageSignature = {
  label: string;
  documentation?: string;
  parameters: LanguageSignatureHelpParameter[];
};

export type LanguageSignatureHelp = {
  signatures: LanguageSignature[];
  activeSignature: number;
  activeParameter: number;
};
