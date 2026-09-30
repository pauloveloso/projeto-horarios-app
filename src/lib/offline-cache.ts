import Storage from 'expo-sqlite/kv-store';

type CacheEnvelope<T> = {
  atualizadoEm: string;
  dados: T;
};

export type BuscaSalva = {
  filtro: 'TURMA' | 'PROFESSOR' | 'ESPACO';
  opcaoId: string | null;
  versaoId: string;
};

const CHAVE_VERSOES = 'app-horarios:versoes:v1';
const CHAVE_BUSCA = 'app-horarios:ultima-busca:v1';
const chaveGrade = (versaoId: string) => `app-horarios:grade:${encodeURIComponent(versaoId)}:v1`;

async function ler<T>(chave: string): Promise<CacheEnvelope<T> | null> {
  const valor = await Storage.getItem(chave);
  if (!valor) return null;
  try {
    return JSON.parse(valor) as CacheEnvelope<T>;
  } catch {
    await Storage.removeItem(chave);
    return null;
  }
}

async function salvar<T>(chave: string, dados: T): Promise<string> {
  const atualizadoEm = new Date().toISOString();
  await Storage.setItem(chave, JSON.stringify({ atualizadoEm, dados }));
  return atualizadoEm;
}

export const lerVersoesSalvas = <T,>() => ler<T[]>(CHAVE_VERSOES);
export const salvarVersoes = <T,>(versoes: T[]) => salvar(CHAVE_VERSOES, versoes);
export const lerGradeSalva = <T,>(versaoId: string) => ler<T>(chaveGrade(versaoId));
export const salvarGrade = <T,>(versaoId: string, grade: T) => salvar(chaveGrade(versaoId), grade);

export async function lerBuscaSalva(): Promise<BuscaSalva | null> {
  const valor = await Storage.getItem(CHAVE_BUSCA);
  if (!valor) return null;
  try {
    const busca = JSON.parse(valor) as BuscaSalva;
    if (!busca.versaoId || !['TURMA', 'PROFESSOR', 'ESPACO'].includes(busca.filtro)) return null;
    return busca;
  } catch {
    await Storage.removeItem(CHAVE_BUSCA);
    return null;
  }
}

export const salvarBusca = (busca: BuscaSalva) => Storage.setItem(CHAVE_BUSCA, JSON.stringify(busca));
