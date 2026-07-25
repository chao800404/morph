export interface OptionTemplateValueDTO {
  id: string;
  templateId: string;
  value: string;
  rank: number;
}

export interface OptionTemplateDTO {
  id: string;
  title: string;
  rank: number;
  values: OptionTemplateValueDTO[];
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOptionTemplateDTO {
  title: string;
  rank?: number;
  /** Values in display order. */
  values: string[];
  createdBy: string;
  updatedBy: string;
}

export interface OptionTemplateInsertDTO extends CreateOptionTemplateDTO {
  id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UpdateOptionTemplateDTO {
  title?: string;
  rank?: number;
  /** When present, replaces the template's whole value list. */
  values?: string[];
  updatedBy: string;
}
