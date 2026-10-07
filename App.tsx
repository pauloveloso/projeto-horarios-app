import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import { supabase, supabaseConfigured } from './src/lib/supabase';
import { lerBuscaSalva, lerGradeSalva, lerVersoesSalvas, salvarBusca, salvarGrade, salvarVersoes, type BuscaSalva } from './src/lib/offline-cache';

type Filtro = 'TURMA' | 'PROFESSOR' | 'ESPACO';
type Versao = { id: string; nome: string; semestre: string; status: string; data_inicio_vigencia: string };
type Registro = Record<string, any>;
type Dados = {
  aulas: Registro[]; turmas: Registro[]; cursos: Registro[]; professores: Registro[];
  disciplinas: Registro[]; espacos: Registro[]; categorias: Registro[]; slots: Registro[];
};
type Opcao = { id: string; titulo: string; detalhe?: string };
type GradeSalva = { versao: Versao | null; dados: Dados };

const DIAS = [
  { id: 'SEGUNDA', nome: 'Seg' }, { id: 'TERCA', nome: 'Ter' },
  { id: 'QUARTA', nome: 'Qua' }, { id: 'QUINTA', nome: 'Qui' }, { id: 'SEXTA', nome: 'Sex' },
];
const URL_POLITICA_PRIVACIDADE = "https://pauloveloso.github.io/projeto-horarios-app/privacy-policy.html";

const diaAtualId = () => {
  const diaDaSemana = new Date().getDay();
  return DIAS[diaDaSemana >= 1 && diaDaSemana <= 5 ? diaDaSemana - 1 : 0].id;
};
const VAZIO: Dados = { aulas: [], turmas: [], cursos: [], professores: [], disciplinas: [], espacos: [], categorias: [], slots: [] };
const hojeISO = () => {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
};
const hora = (valor?: string) => valor?.slice(0, 5) ?? '';
const texto = (valor?: string | null) => valor?.trim() || '';
const dataPt = (valor?: string) => valor ? valor.slice(0, 10).split('-').reverse().join('/') : '';
const dataHoraPt = (valor?: string | null) => valor ? new Date(valor).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
const escaparHtml = (valor: string) => valor.replace(/[&<>"']/g, (caractere) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[caractere] ?? caractere);

const montarOpcoes = (filtro: Filtro, dados: Dados): Opcao[] => {
  if (filtro === 'TURMA') {
    return dados.cursos.flatMap((curso) => dados.turmas.filter((turma) => String(turma.curso_id) === String(curso.id)).map((turma) => ({ id: String(turma.id), titulo: texto(turma.codigo) || 'Turma', detalhe: texto(curso.nome) })));
  }
  if (filtro === 'PROFESSOR') return dados.professores.map((p) => ({ id: String(p.id), titulo: texto(p.nome) || 'Professor(a)' }));
  return dados.categorias.flatMap((categoria) => dados.espacos.filter((espaco) => String(espaco.categoria_id) === String(categoria.id)).map((espaco) => ({ id: String(espaco.id), titulo: texto(espaco.nome) || 'Espaço', detalhe: texto(categoria.nome) })));
};

export default function App() {
  const [versoes, setVersoes] = useState<Versao[]>([]);
  const [versaoId, setVersaoId] = useState('');
  const [dados, setDados] = useState<Dados>(VAZIO);
  const [filtro, setFiltro] = useState<Filtro>('TURMA');
  const [selecionado, setSelecionado] = useState<Opcao | null>(null);
  const [dia, setDia] = useState(diaAtualId);
  const [modal, setModal] = useState<'versao' | 'opcao' | null>(null);
  const [busca, setBusca] = useState('');
  const [carregandoVersoes, setCarregandoVersoes] = useState(true);
  const [carregandoGrade, setCarregandoGrade] = useState(false);
  const [dadosCarregados, setDadosCarregados] = useState(false);
  const [preferenciasCarregadas, setPreferenciasCarregadas] = useState(false);
  const [buscaPendente, setBuscaPendente] = useState<BuscaSalva | null>(null);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<string | null>(null);
  const [semConexao, setSemConexao] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [erro, setErro] = useState('');
  const [atualizando, setAtualizando] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const ultimaVersaoRef = useRef('');
  const versoesRef = useRef(versoes);

  useEffect(() => { versoesRef.current = versoes; }, [versoes]);

  const carregarVersoes = useCallback(async (preferencia?: BuscaSalva | null) => {
    if (!supabaseConfigured) {
      setCarregandoVersoes(false);
      return;
    }
    setErro('');
    let publicadas: Versao[];
    try {
      const { data, error } = await supabase.from('versoes_grade').select('*').eq('status', 'PUBLICADA').order('data_inicio_vigencia', { ascending: false });
      if (error) throw error;
      publicadas = (data ?? []) as Versao[];
    } catch {
      setSemConexao(true);
      setErro('Não foi possível carregar as versões da grade. Verifique sua conexão e tente novamente.');
      setCarregandoVersoes(false);
      setAtualizando(false);
      return;
    }
    try { await salvarVersoes(publicadas); } catch (falha) { console.warn('Não foi possível salvar as versões no dispositivo:', falha); }
    setVersoes(publicadas);
    if (!publicadas.length) {
      setDados(VAZIO);
      setDadosCarregados(false);
      setSelecionado(null);
    }
    const atual = publicadas.find((v) => v.data_inicio_vigencia <= hojeISO()) ?? publicadas[0];
    setVersaoId((anterior) => publicadas.some((v) => String(v.id) === String(anterior)) ? anterior : publicadas.some((v) => String(v.id) === String(preferencia?.versaoId)) ? String(preferencia?.versaoId) : atual?.id ?? '');
    setCarregandoVersoes(false);
    setAtualizando(false);
  }, []);

  useEffect(() => {
    let ativo = true;
    const iniciar = async () => {
      let versoesSalvas: { atualizadoEm: string; dados: Versao[] } | null = null;
      let buscaSalva: BuscaSalva | null = null;
      try {
        [versoesSalvas, buscaSalva] = await Promise.all([lerVersoesSalvas<Versao>(), lerBuscaSalva()]);
      } catch (falha) {
        console.warn('Não foi possível ler os dados salvos no dispositivo:', falha);
      }
      if (!ativo) return;
      setBuscaPendente(buscaSalva);
      if (buscaSalva) setFiltro(buscaSalva.filtro);
      if (versoesSalvas?.dados.length) {
        setVersoes(versoesSalvas.dados);
        setUltimaAtualizacao(versoesSalvas.atualizadoEm);
        const preferida = versoesSalvas.dados.find((v) => String(v.id) === String(buscaSalva?.versaoId));
        const atual = versoesSalvas.dados.find((v) => v.data_inicio_vigencia <= hojeISO()) ?? versoesSalvas.dados[0];
        setVersaoId(String((preferida ?? atual)?.id ?? ''));
      } else if (buscaSalva?.versaoId) {
        setVersaoId(buscaSalva.versaoId);
      }
      setCarregandoVersoes(false);
      setPreferenciasCarregadas(true);
      if (supabaseConfigured) void carregarVersoes(buscaSalva);
      else if (!versoesSalvas?.dados.length) setErro('Falta conectar o Supabase e ainda não há horários salvos neste dispositivo.');
    };
    void iniciar();
    return () => { ativo = false; };
  }, [carregarVersoes]);

  useEffect(() => {
    if (!preferenciasCarregadas || !versaoId) return;
    if (ultimaVersaoRef.current && ultimaVersaoRef.current !== versaoId) {
      void salvarBusca({ filtro, opcaoId: null, versaoId });
    }
    ultimaVersaoRef.current = versaoId;
  }, [filtro, preferenciasCarregadas, versaoId]);

  useEffect(() => {
    if (!versaoId) return;
    let ativo = true;
    const carregar = async () => {
      setCarregandoGrade(true);
      setDadosCarregados(false);
      setDados(VAZIO);
      setUltimaAtualizacao(null);
      setSemConexao(false);
      setErro('');
      let cache: { atualizadoEm: string; dados: GradeSalva } | null = null;
      try {
        cache = await lerGradeSalva<GradeSalva>(versaoId);
      } catch (falha) {
        console.warn('Não foi possível ler a grade salva no dispositivo:', falha);
      }
      if (!ativo) return;
      if (cache) {
        setDados(cache.dados.dados);
        setDadosCarregados(true);
        setUltimaAtualizacao(cache.atualizadoEm);
        setCarregandoGrade(false);
        if (cache.dados.versao) setVersoes((anteriores) => anteriores.some((v) => String(v.id) === String(cache?.dados.versao?.id)) ? anteriores : [...anteriores, cache!.dados.versao!]);
      }
      if (!supabaseConfigured) {
        if (!cache) setErro('Falta conectar o Supabase e ainda não há horários salvos para esta grade.');
        setCarregandoGrade(false);
        setSincronizando(false);
        return;
      }
      setSincronizando(true);
      const consultas = [
        supabase.from('aulas').select('*').eq('versao_id', versaoId).limit(5000),
        supabase.from('turmas').select('*').order('codigo').limit(2000),
        supabase.from('cursos').select('*').order('nome'),
        supabase.from('professores').select('*').order('nome').limit(1000),
        supabase.from('disciplinas').select('*').order('nome').limit(5000),
        supabase.from('espacos').select('*').order('nome').limit(1000),
        supabase.from('categorias_espacos').select('*').order('nome'),
        supabase.from('slots_horarios').select('*').order('hora_inicio'),
      ];
      const respostas = await Promise.all(consultas.map((consulta) => Promise.resolve(consulta).catch((falha: unknown) => ({ data: null, error: falha }))));
      if (!ativo) return;
      const falha = respostas.find((resposta) => resposta.error)?.error;
      if (falha) {
        setSemConexao(true);
        setErro(cache ? '' : 'Não foi possível carregar os horários. Verifique sua conexão e tente novamente.');
      } else {
        const [aulas, turmas, cursos, professores, disciplinas, espacos, categorias, slots] = respostas.map((resposta) => resposta.data ?? []);
        const dadosNovos: Dados = { aulas: aulas as Registro[], turmas: turmas as Registro[], cursos: cursos as Registro[], professores: professores as Registro[], disciplinas: disciplinas as Registro[], espacos: espacos as Registro[], categorias: categorias as Registro[], slots: slots as Registro[] };
        const versaoAtual = versoesRef.current.find((item) => String(item.id) === String(versaoId)) ?? cache?.dados.versao ?? null;
        setDados(dadosNovos);
        setDadosCarregados(true);
        setSemConexao(false);
        setErro('');
        try {
          const salvoEm = await salvarGrade(versaoId, { versao: versaoAtual, dados: dadosNovos });
          setUltimaAtualizacao(salvoEm);
        } catch (falhaCache) {
          console.warn('Horários carregados, mas não foi possível salvá-los no dispositivo:', falhaCache);
          setUltimaAtualizacao(new Date().toISOString());
        }
      }
      setCarregandoGrade(false);
      setSincronizando(false);
    };
    void carregar();
    return () => { ativo = false; };
  }, [versaoId, reloadToken]);

  const opcoes = useMemo<Opcao[]>(() => montarOpcoes(filtro, dados), [dados, filtro]);

  useEffect(() => {
    if (!preferenciasCarregadas || !dadosCarregados || !versaoId || !buscaPendente) return;
    let ativo = true;
    const restaurar = async () => {
      await Promise.resolve();
      if (!ativo) return;
      if (String(buscaPendente.versaoId) !== String(versaoId)) {
        setBuscaPendente(null);
        return;
      }
      const opcao = buscaPendente.opcaoId ? montarOpcoes(buscaPendente.filtro, dados).find((item) => item.id === buscaPendente.opcaoId) ?? null : null;
      setFiltro(buscaPendente.filtro);
      setSelecionado(opcao);
      setDia(diaAtualId());
      setBuscaPendente(null);
      if (!opcao && buscaPendente.opcaoId) void salvarBusca({ ...buscaPendente, opcaoId: null });
    };
    void restaurar();
    return () => { ativo = false; };
  }, [buscaPendente, dados, dadosCarregados, preferenciasCarregadas, versaoId]);

  const aulasSelecionadas = useMemo(() => dados.aulas.filter((aula) => {
    const campo = filtro === 'TURMA' ? aula.turma_id : filtro === 'PROFESSOR' ? aula.professor_id : aula.espaco_id;
    return selecionado && String(campo) === selecionado.id;
  }), [dados.aulas, filtro, selecionado]);
  const slotsOcupados = useMemo(() => new Set(aulasSelecionadas.map((aula) => String(aula.slot_horario_id))), [aulasSelecionadas]);
  const slotsDoDia = useMemo(() => dados.slots.filter((slot) => slotsOcupados.has(String(slot.id)) && aulasSelecionadas.some((aula) => aula.dia_semana === dia && String(aula.slot_horario_id) === String(slot.id))), [aulasSelecionadas, dados.slots, dia, slotsOcupados]);
  const versao = versoes.find((item) => String(item.id) === String(versaoId));
  const opcoesVisiveis = opcoes.filter((opcao) => `${opcao.titulo} ${opcao.detalhe ?? ''}`.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR')));

  const escolherFiltro = (novo: Filtro) => { setFiltro(novo); setSelecionado(null); setDia(diaAtualId()); setBusca(''); };
  const selecionarOpcao = (opcao: Opcao) => {
    setSelecionado(opcao); setDia(diaAtualId()); setModal(null); setBusca('');
    if (versaoId) void salvarBusca({ filtro, opcaoId: opcao.id, versaoId });
  };
  const atualizar = () => { setAtualizando(true); setReloadToken((valor) => valor + 1); void carregarVersoes(); };

  const abrirSeletor = (qual: 'versao' | 'opcao') => { setBusca(''); setModal(qual); };
  const abrirPoliticaPrivacidade = async () => {
    try {
      await Linking.openURL(URL_POLITICA_PRIVACIDADE);
    } catch {
      Alert.alert('Não foi possível abrir a política', 'Verifique sua conexão e tente novamente.');
    }
  };

  const gerarPdfGrade = async () => {
    if (!selecionado || !aulasSelecionadas.length) return;
    setGerandoPdf(true);
    let etapa = 'preparar a grade';
    try {
      const slotsDaGrade = dados.slots.filter((slot) => aulasSelecionadas.some((aula) => String(aula.slot_horario_id) === String(slot.id)));
      const cabecalhoDias = DIAS.map((item) => `<th>${item.nome.toUpperCase()}</th>`).join('');
      const linhas = slotsDaGrade.map((slot) => {
        const celulas = DIAS.map((item) => {
          const itens = aulasSelecionadas.filter((aula) => aula.dia_semana === item.id && String(aula.slot_horario_id) === String(slot.id));
          const conteudo = itens.map((aula) => {
            const disciplina = dados.disciplinas.find((registro) => String(registro.id) === String(aula.disciplina_id));
            const professor = dados.professores.find((registro) => String(registro.id) === String(aula.professor_id));
            const espaco = dados.espacos.find((registro) => String(registro.id) === String(aula.espaco_id));
            const turma = dados.turmas.find((registro) => String(registro.id) === String(aula.turma_id));
            const detalhes = [filtro !== 'TURMA' ? texto(turma?.codigo) : '', filtro !== 'PROFESSOR' ? texto(professor?.nome) || 'Professor a definir' : '', filtro !== 'ESPACO' ? texto(espaco?.nome) || 'Espaço não informado' : ''].filter(Boolean).map(escaparHtml).join('<br>');
            return `<div class="aula"><strong>${escaparHtml(texto(disciplina?.nome) || 'Disciplina')}</strong>${detalhes ? `<small>${detalhes}</small>` : ''}</div>`;
          }).join('');
          return `<td>${conteudo}</td>`;
        }).join('');
        return `<tr><th class="hora">${hora(slot.hora_inicio)}<br><small>${hora(slot.hora_fim)}</small></th>${celulas}</tr>`;
      }).join('');
      const rotuloFiltro = filtro === 'TURMA' ? 'Turma' : filtro === 'PROFESSOR' ? 'Professor(a)' : 'Espaço';
      const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>@page{size:landscape;margin:12mm}body{font-family:Arial,sans-serif;color:#17251e}h1{text-align:center;font-size:19px;margin:0 0 5px}p{text-align:center;color:#53635a;font-size:11px;margin:0 0 16px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #829188;padding:5px;vertical-align:top;font-size:9px}thead th{background:#e7f2e9;text-align:center}.hora{width:58px;background:#f1f4f1;text-align:center}.aula{margin:2px 0 4px;padding:4px;border-left:2px solid #24734f;background:#f6faf7}.aula small{display:block;color:#52645a;font-size:8px;line-height:1.35;margin-top:2px}</style></head><body><h1>IFNMG — Campus Januária · Quadro de Horário</h1><p>${escaparHtml(rotuloFiltro)}: ${escaparHtml(selecionado.titulo)} · ${escaparHtml(versao?.nome ?? '')} · Vigência: ${dataPt(versao?.data_inicio_vigencia)}</p><table><thead><tr><th class="hora">HORÁRIO</th>${cabecalhoDias}</tr></thead><tbody>${linhas}</tbody></table></body></html>`;
      etapa = 'abrir a impressão';
      await Print.printAsync({ html, width: 792, height: 612, orientation: Print.Orientation.landscape });
    } catch (erro) {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      console.error(`Falha ao ${etapa}:`, erro);
      Alert.alert('Não foi possível gerar o PDF', `Falha ao ${etapa}. ${detalhe}`);
    } finally {
      setGerandoPdf(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.green950} />
      <View style={styles.header}>
        <View style={styles.brandLine}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>H</Text></View>
          <View style={styles.brandCopy}>
            <Text style={styles.brandTitle}>HORÁRIOS</Text>
            <Text style={styles.brandSubtitle}>IFNMG · CAMPUS JANUÁRIA</Text>
          </View>
          <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>CONSULTA</Text></View>
        </View>
        <Text style={styles.headerDescription}>Consulte aulas por turma, professor ou espaço.</Text>
        <Pressable style={styles.versionButton} onPress={() => abrirSeletor('versao')} disabled={!versoes.length}>
          <View><Text style={styles.versionLabel}>GRADE SELECIONADA</Text><Text style={styles.versionName}>{versao ? `${versao.nome} · Vigência ${dataPt(versao.data_inicio_vigencia)}` : carregandoVersoes ? 'Carregando versões…' : 'Nenhuma grade publicada'}</Text></View>
          <Text style={styles.chevron}>⌄</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={atualizando} onRefresh={atualizar} tintColor={colors.green700} colors={[colors.green700]} />}>
        {!supabaseConfigured && !dadosCarregados ? (
          <View style={styles.noticeCard}><Text style={styles.noticeIcon}>⚙</Text><Text style={styles.noticeTitle}>Falta conectar o Supabase</Text><Text style={styles.noticeText}>Copie o arquivo .env.example para .env e preencha a URL e a chave pública do projeto. Depois reinicie o Expo.</Text></View>
        ) : erro && !dadosCarregados ? (
          <View style={styles.noticeCard}><Text style={styles.noticeIcon}>⌁</Text><Text style={styles.noticeTitle}>Não foi possível atualizar</Text><Text style={styles.noticeText}>{erro}</Text><Pressable style={styles.retryButton} onPress={atualizar}><Text style={styles.retryText}>Tentar novamente</Text></Pressable></View>
        ) : (
          <>
            {dadosCarregados && (semConexao || sincronizando) && <View style={{ backgroundColor: '#e8f5ec', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 14 }}><Text style={{ color: colors.green800, fontSize: 10, fontWeight: '700' }}>{semConexao ? `Sem conexão. Exibindo dados salvos em ${dataHoraPt(ultimaAtualizacao)}.` : 'Dados salvos no dispositivo. Verificando atualizações…'}</Text></View>}
            <View style={styles.sectionHeadingRow}><Text style={[styles.eyebrow, styles.quickEyebrow]}>CONSULTA RÁPIDA</Text><View style={styles.classCount}><Text style={styles.classCountNumber}>{aulasSelecionadas.length}</Text><Text style={styles.classCountLabel}>AULAS</Text></View></View>
            <View style={styles.filterRow}>
              {([{ id: 'TURMA', label: 'Turma' }, { id: 'PROFESSOR', label: 'Professor' }, { id: 'ESPACO', label: 'Espaço' }] as const).map((item) => <Pressable key={item.id} onPress={() => escolherFiltro(item.id)} style={[styles.filterChip, filtro === item.id && styles.filterChipActive]}><Text style={[styles.filterText, filtro === item.id && styles.filterTextActive]}>{item.label}</Text></Pressable>)}
            </View>
            <Pressable style={styles.selectButton} onPress={() => abrirSeletor('opcao')}>
              <View style={styles.selectIcon}><Text style={styles.selectIconText}>{filtro === 'TURMA' ? '▦' : filtro === 'PROFESSOR' ? '◉' : '⌂'}</Text></View>
              <View style={styles.selectCopy}><Text style={styles.selectLabel}>{selecionado ? filtro === 'TURMA' ? 'TURMA SELECIONADA' : filtro === 'PROFESSOR' ? 'PROFESSOR(A) SELECIONADO(A)' : 'ESPAÇO SELECIONADO' : 'SELECIONE PARA CONSULTAR'}</Text><Text style={[styles.selectValue, !selecionado && styles.selectPlaceholder]} numberOfLines={1}>{selecionado?.titulo ?? 'Escolha uma opção'}</Text></View>
              <Text style={styles.selectChevron}>⌄</Text>
            </Pressable>

            {(carregandoVersoes || carregandoGrade) && !dadosCarregados ? <View style={styles.loading}><ActivityIndicator color={colors.green700} /><Text style={styles.loadingText}>Buscando horários atualizados…</Text></View> : !selecionado ? (
              <View style={styles.emptyWelcome}><View style={styles.emptyIllustration}><Text style={styles.emptyEmoji}>▤</Text><View style={styles.emptySun} /></View><Text style={styles.emptyTitle}>Seu próximo horário começa aqui</Text><Text style={styles.emptyText}>Selecione uma turma, professor ou espaço para ver as aulas da semana.</Text></View>
            ) : (
              <>
                <View style={styles.scheduleHeading}><View><Text style={styles.eyebrow}>GRADE SEMANAL</Text><Text style={styles.scheduleTitle}>{selecionado.titulo}</Text><Text style={styles.scheduleSub}>{selecionado.detalhe ? `${selecionado.detalhe} · ` : ''}Vigência: {dataPt(versao?.data_inicio_vigencia)}</Text></View><View style={styles.calendarIcon}><Text style={styles.calendarGlyph}>▦</Text></View></View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>{DIAS.map((item) => { const ativo = dia === item.id; const total = aulasSelecionadas.filter((aula) => aula.dia_semana === item.id).length; return <Pressable key={item.id} onPress={() => setDia(item.id)} style={[styles.dayChip, ativo && styles.dayChipActive]}><Text style={[styles.dayText, ativo && styles.dayTextActive]}>{item.nome}</Text><Text style={[styles.dayNumber, ativo && styles.dayNumberActive]}>{total}</Text></Pressable>; })}</ScrollView>
                <Pressable style={[styles.pdfButton, gerandoPdf && styles.pdfButtonBusy]} onPress={gerarPdfGrade} disabled={gerandoPdf || !aulasSelecionadas.length}><Text style={styles.pdfGlyph}>{gerandoPdf ? '…' : '⇩'}</Text><Text style={styles.pdfButtonText}>{gerandoPdf ? 'Preparando PDF…' : 'Gerar PDF da grade semanal'}</Text></Pressable>
                {slotsDoDia.length === 0 ? <View style={styles.emptyDay}><Text style={styles.emptyDayIcon}>☼</Text><Text style={styles.emptyDayTitle}>Dia livre</Text><Text style={styles.emptyDayText}>Não há aulas para {DIAS.find((item) => item.id === dia)?.nome.toLowerCase()} nesta seleção.</Text></View> : slotsDoDia.map((slot) => {
                  const aulasSlot = aulasSelecionadas.filter((aula) => aula.dia_semana === dia && String(aula.slot_horario_id) === String(slot.id));
                  const periodo = slot.hora_inicio < '12:00' ? 'MANHÃ' : slot.hora_inicio < '18:00' ? 'TARDE' : 'NOITE';
                  return <View key={String(slot.id)} style={styles.classRow}><View style={styles.timeColumn}><Text style={styles.timeStart}>{hora(slot.hora_inicio)}</Text><View style={styles.timeLine} /><Text style={styles.timeEnd}>{hora(slot.hora_fim)}</Text><Text style={styles.periodLabel}>{periodo}</Text></View><View style={styles.classStack}>{aulasSlot.map((aula) => {
                    const disciplina = dados.disciplinas.find((item) => String(item.id) === String(aula.disciplina_id));
                    const professor = dados.professores.find((item) => String(item.id) === String(aula.professor_id));
                    const espaco = dados.espacos.find((item) => String(item.id) === String(aula.espaco_id));
                    const turma = dados.turmas.find((item) => String(item.id) === String(aula.turma_id));
                    return <View key={String(aula.id)} style={styles.classCard}><View style={styles.classCardTop}><View style={styles.subjectDot} /><Text style={styles.subjectName}>{texto(disciplina?.nome) || 'Disciplina'}</Text></View>{filtro !== 'TURMA' && <Text style={styles.classMeta}>▦  {texto(turma?.codigo) || 'Turma'}</Text>}{filtro !== 'PROFESSOR' && <Text style={styles.classMeta}>◉  {texto(professor?.nome) || 'Professor a definir'}</Text>}{filtro !== 'ESPACO' && <Text style={styles.classMeta}>⌂  {texto(espaco?.nome) || 'Espaço não informado'}</Text>}</View>;
                  })}</View></View>;
                })}
              </>
            )}
          </>
        )}
        <View style={styles.footer}><Text style={styles.footerMark}>IFNMG</Text><Text style={styles.footerText}>Instituto Federal do Norte de Minas Gerais</Text><Text style={styles.footerCampus}>Campus Januária · Horários acadêmicos</Text><Pressable accessibilityRole="link" onPress={abrirPoliticaPrivacidade} style={styles.privacyLink}><Text style={styles.privacyLinkText}>Política de Privacidade</Text></Pressable></View>
      </ScrollView>

      <Modal transparent visible={modal !== null} animationType="slide" onRequestClose={() => setModal(null)}>
        <View style={styles.modalBackdrop}><Pressable style={StyleSheet.absoluteFill} onPress={() => setModal(null)} /><View style={styles.sheet}><View style={styles.sheetHandle} /><View style={styles.sheetTitleRow}><View><Text style={styles.eyebrow}>{modal === 'versao' ? 'GRADE ACADÊMICA' : 'CONSULTA DE HORÁRIOS'}</Text><Text style={styles.sheetTitle}>{modal === 'versao' ? 'Escolha a versão' : filtro === 'TURMA' ? 'Escolha uma turma' : filtro === 'PROFESSOR' ? 'Escolha um professor' : 'Escolha um espaço'}</Text></View><Pressable onPress={() => setModal(null)} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable></View>
          {modal === 'opcao' && <TextInput value={busca} onChangeText={setBusca} placeholder={filtro === 'TURMA' ? 'Buscar turma ou curso' : filtro === 'PROFESSOR' ? 'Buscar professor' : 'Buscar espaço'} placeholderTextColor={colors.muted} style={styles.searchInput} autoCorrect={false} />}
          <FlatList data={modal === 'versao' ? versoes.map((item) => ({ id: String(item.id), titulo: `${item.nome} · Vigência ${dataPt(item.data_inicio_vigencia)}`, detalhe: item.data_inicio_vigencia > hojeISO() ? 'Prévia' : item.status === 'PUBLICADA' ? 'Publicada' : '' })) : opcoesVisiveis} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled" ListEmptyComponent={<Text style={styles.listEmpty}>{modal === 'versao' ? 'Nenhuma grade publicada.' : 'Nenhuma opção encontrada.'}</Text>} renderItem={({ item }) => <Pressable onPress={() => { if (modal === 'versao') { setVersaoId(item.id); setSelecionado(null); setDia(diaAtualId()); setModal(null); } else selecionarOpcao(item); }} style={styles.optionRow}><View style={styles.optionCopy}><Text style={styles.optionTitle}>{item.titulo}</Text>{item.detalhe ? <Text style={styles.optionDetail}>{item.detalhe}</Text> : null}</View><Text style={styles.optionArrow}>›</Text></Pressable>} />
        </View></View>
      </Modal>
    </SafeAreaView>
  );
}

const colors = { green950: '#092b22', green900: '#103d30', green800: '#15533e', green700: '#1c7252', green600: '#2c946b', mint: '#d9f5e7', ink: '#14261f', muted: '#7d8c85', canvas: '#f4f7f4', border: '#e6ece7', white: '#ffffff' };
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas }, header: { backgroundColor: colors.green950, paddingHorizontal: 22, paddingTop: 14, paddingBottom: 22, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 }, brandLine: { flexDirection: 'row', alignItems: 'center' }, brandMark: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#c6f1dc', alignItems: 'center', justifyContent: 'center' }, brandMarkText: { color: colors.green900, fontSize: 21, fontWeight: '900' }, brandCopy: { marginLeft: 10, flex: 1 }, brandTitle: { color: colors.white, fontSize: 14, fontWeight: '900', letterSpacing: 1.4 }, brandSubtitle: { color: '#a6c8b9', fontSize: 9, fontWeight: '700', letterSpacing: 1.1, marginTop: 2 }, liveBadge: { borderColor: '#3e6959', borderWidth: 1, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5 }, liveDot: { width: 6, height: 6, borderRadius: 4, backgroundColor: '#71e0a8' }, liveText: { color: '#c7ead8', fontSize: 8, fontWeight: '800', letterSpacing: 0.8 }, headerHeading: { marginTop: 25, color: colors.white, fontSize: 25, fontWeight: '800', letterSpacing: -0.6 }, headerDescription: { marginTop: 5, color: '#b2cfc1', fontSize: 12 }, versionButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14, backgroundColor: '#174637', borderWidth: 1, borderColor: '#2b604e' }, versionLabel: { color: '#8fbaa6', fontSize: 8, fontWeight: '800', letterSpacing: 1.1 }, versionName: { color: colors.white, fontSize: 12, fontWeight: '700', marginTop: 4 }, chevron: { color: '#a9cfbb', fontSize: 20 }, content: { flex: 1 }, contentInner: { paddingHorizontal: 20, paddingTop: 23, paddingBottom: 22 }, sectionHeadingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }, eyebrow: { color: colors.green700, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 }, sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '800', marginTop: 4 }, classCount: { alignItems: 'center', minWidth: 48, paddingVertical: 6, paddingHorizontal: 9, backgroundColor: '#e4f3e9', borderRadius: 12 }, classCountNumber: { color: colors.green800, fontSize: 15, fontWeight: '900' }, classCountLabel: { color: colors.green700, fontSize: 7, fontWeight: '800', letterSpacing: 0.8 }, filterRow: { flexDirection: 'row', gap: 8, marginTop: 17 }, filterChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 22, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border }, filterChipActive: { backgroundColor: colors.green800, borderColor: colors.green800 }, filterText: { color: '#617169', fontSize: 11, fontWeight: '700' }, filterTextActive: { color: colors.white }, selectButton: { backgroundColor: colors.white, marginTop: 11, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center' }, selectIcon: { width: 39, height: 39, backgroundColor: '#e8f5ec', borderRadius: 12, justifyContent: 'center', alignItems: 'center' }, selectIconText: { color: colors.green700, fontSize: 20, fontWeight: '800' }, selectCopy: { flex: 1, marginLeft: 11 }, selectLabel: { color: colors.muted, fontSize: 8, fontWeight: '800', letterSpacing: 0.8 }, selectValue: { color: colors.ink, fontSize: 13, fontWeight: '800', marginTop: 4 }, selectPlaceholder: { color: '#87958e', fontWeight: '600' }, selectChevron: { color: colors.green700, fontSize: 20, paddingHorizontal: 3 }, loading: { alignItems: 'center', paddingVertical: 50, gap: 12 }, loadingText: { color: colors.muted, fontSize: 12 }, emptyWelcome: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 36, paddingBottom: 29 }, emptyIllustration: { width: 106, height: 106, backgroundColor: '#e6f3e9', borderRadius: 36, justifyContent: 'center', alignItems: 'center', transform: [{ rotate: '-4deg' }] }, emptyEmoji: { color: colors.green700, fontSize: 49, fontWeight: '300', transform: [{ rotate: '4deg' }] }, emptySun: { width: 14, height: 14, borderRadius: 9, backgroundColor: '#aedfc1', position: 'absolute', top: 17, right: 17 }, emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: '800', marginTop: 20 }, emptyText: { color: colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 19, marginTop: 7, maxWidth: 275 }, scheduleHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 15 }, scheduleTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', marginTop: 4 }, scheduleSub: { color: colors.muted, fontSize: 11, marginTop: 3 }, calendarIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#e4f3e9', alignItems: 'center', justifyContent: 'center' }, calendarGlyph: { color: colors.green700, fontSize: 21 }, dayRow: { gap: 8, paddingBottom: 14 }, dayChip: { minWidth: 55, paddingVertical: 8, paddingHorizontal: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border }, dayChipActive: { backgroundColor: colors.green800, borderColor: colors.green800 }, dayText: { color: '#53635a', fontSize: 10, fontWeight: '700' }, dayTextActive: { color: colors.white }, dayNumber: { color: colors.green700, backgroundColor: '#e4f3e9', fontSize: 9, fontWeight: '900', overflow: 'hidden', textAlign: 'center', borderRadius: 10, minWidth: 16, paddingVertical: 2 }, dayNumberActive: { color: colors.green900, backgroundColor: '#c6f1dc' }, classRow: { flexDirection: 'row', marginBottom: 12 }, timeColumn: { width: 59, alignItems: 'flex-start', paddingTop: 12 }, timeStart: { color: colors.ink, fontSize: 12, fontWeight: '900' }, timeLine: { width: 1, height: 8, marginVertical: 3, backgroundColor: '#b9c9bf', marginLeft: 2 }, timeEnd: { color: colors.muted, fontSize: 10, fontWeight: '600' }, periodLabel: { color: colors.green700, fontSize: 7, fontWeight: '900', marginTop: 6, letterSpacing: 0.6 }, classStack: { flex: 1, gap: 7 }, classCard: { backgroundColor: colors.white, borderRadius: 15, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, paddingVertical: 11, borderLeftWidth: 3, borderLeftColor: colors.green600 }, classCardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 }, subjectDot: { width: 7, height: 7, backgroundColor: colors.green600, borderRadius: 5, marginRight: 7 }, subjectName: { color: colors.ink, flex: 1, fontSize: 12, fontWeight: '900' }, classMeta: { color: '#617169', fontSize: 10, marginTop: 3, lineHeight: 15 }, emptyDay: { alignItems: 'center', padding: 27, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, marginTop: 3 }, emptyDayIcon: { color: colors.green600, fontSize: 24 }, emptyDayTitle: { color: colors.ink, fontSize: 14, fontWeight: '800', marginTop: 8 }, emptyDayText: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 4 }, noticeCard: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 20, alignItems: 'center', marginTop: 18 }, noticeIcon: { color: colors.green700, fontSize: 29 }, noticeTitle: { color: colors.ink, fontSize: 16, fontWeight: '800', marginTop: 9 }, noticeText: { color: colors.muted, textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 7 }, retryButton: { backgroundColor: colors.green800, paddingHorizontal: 17, paddingVertical: 10, borderRadius: 11, marginTop: 15 }, retryText: { color: colors.white, fontSize: 11, fontWeight: '800' }, footer: { alignItems: 'center', paddingTop: 24, paddingBottom: 12, borderTopWidth: 1, borderColor: '#e7ece8', marginTop: 20 }, footerMark: { color: colors.green800, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 }, footerText: { color: '#7b8981', fontSize: 9, marginTop: 4 }, footerCampus: { color: '#97a39c', fontSize: 8, marginTop: 3 }, privacyLink: { marginTop: 12, paddingVertical: 6 }, privacyLinkText: { color: colors.green700, fontSize: 11, fontWeight: '700', textDecorationLine: 'underline' }, modalBackdrop: { flex: 1, backgroundColor: 'rgba(4,22,16,0.48)', justifyContent: 'flex-end' }, sheet: { maxHeight: '82%', backgroundColor: colors.canvas, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 11, paddingBottom: 26 }, sheetHandle: { width: 37, height: 4, borderRadius: 4, backgroundColor: '#cbd5ce', alignSelf: 'center', marginBottom: 18 }, sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }, sheetTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', marginTop: 4 }, closeButton: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#e7eee8', alignItems: 'center', justifyContent: 'center' }, closeText: { color: '#4a5a50', fontSize: 24, lineHeight: 26 }, searchInput: { backgroundColor: colors.white, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, fontSize: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 9 }, optionRow: { minHeight: 57, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center' }, optionCopy: { flex: 1 }, optionTitle: { color: colors.ink, fontSize: 13, fontWeight: '800' }, optionDetail: { color: colors.muted, fontSize: 10, marginTop: 3 }, optionArrow: { color: colors.green700, fontSize: 24, paddingHorizontal: 7 }, listEmpty: { color: colors.muted, fontSize: 12, textAlign: 'center', padding: 25 },
  pdfButton: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 11, borderWidth: 1, borderColor: '#cde2d3', backgroundColor: '#edf7ef', paddingHorizontal: 11, paddingVertical: 8, marginBottom: 12 },
  pdfButtonBusy: { opacity: 0.65 },
  pdfGlyph: { color: colors.green700, fontSize: 15, fontWeight: '900' },
  pdfButtonText: { color: colors.green800, fontSize: 9, fontWeight: '800' },
  quickEyebrow: { fontSize: 13, letterSpacing: 1.4 },
});
