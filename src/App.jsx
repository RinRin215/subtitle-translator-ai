import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import JSZip from 'jszip';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const App = () => {
  // --- STATES ---
  const [hasUploaded, setHasUploaded] = useState(false);
  const [activeTab, setActiveTab] = useState('processing'); 
  const [filesData, setFilesData] = useState([]); 
  const [historyData, setHistoryData] = useState([]);
  const [activeProcessingId, setActiveProcessingId] = useState(null);
  const [activeHistoryId, setActiveHistoryId] = useState(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [processingStatus, setProcessingStatus] = useState(''); 
  
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [userApiKey, setUserApiKey] = useState('');
  
  const [targetLanguage, setTargetLanguage] = useState('Tiếng Việt');
  const [tone, setTone] = useState('Tự nhiên');
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');
  
  const fileInputRef = useRef(null);
  const ffmpegRef = useRef(new FFmpeg());
  const [isFfmpegLoaded, setIsFfmpegLoaded] = useState(false);

  useEffect(() => {
    const loadFFmpeg = async () => {
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      const ffmpeg = ffmpegRef.current;
      if (ffmpeg.loaded) return;
      try {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setIsFfmpegLoaded(true);
      } catch (error) { console.error("Lỗi tải FFmpeg:", error); }
    };
    loadFFmpeg();
  }, []);

  const currentList = activeTab === 'processing' ? filesData : historyData;
  const currentActiveId = activeTab === 'processing' ? activeProcessingId : activeHistoryId;
  const activeFile = currentList.find(f => f.id === currentActiveId) || currentList[0] || null;
  const currentSubtitles = activeFile ? activeFile.subtitles : [];

  // --- BỘ GIẢI MÃ ---
  const parseSRT = (text) => {
    const blocks = text.replace(/\r/g, '').trim().split('\n\n');
    return blocks.map((block) => {
      const lines = block.split('\n');
      if (lines.length >= 3) return { id: lines[0], start: lines[1].split(' --> ')[0], end: lines[1].split(' --> ')[1], text: lines.slice(2).join('\n'), translatedText: '' };
      return null;
    }).filter(Boolean);
  };

  const parseVTT = (text) => {
    const blocks = text.replace(/\r/g, '').split('\n\n').filter(b => !b.startsWith('WEBVTT') && b.trim() !== '');
    return blocks.map((block, index) => {
      const lines = block.split('\n');
      let timecodeLine = lines[0];
      let textLines = lines.slice(1);
      if (!timecodeLine.includes('-->')) { timecodeLine = lines[1]; textLines = lines.slice(2); }
      if (!timecodeLine) return null;
      const start = timecodeLine.split(' --> ')[0]?.trim().replace('.', ',');
      const end = timecodeLine.split(' --> ')[1]?.trim().replace('.', ',');
      return { id: String(index + 1), start, end, text: textLines.join('\n'), translatedText: '' };
    }).filter(Boolean);
  };

  const parseTXT = (text) => {
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
    return lines.map((line, index) => {
      const startSec = index * 5;
      const formatTime = (sec) => new Date(sec * 1000).toISOString().substring(11, 23).replace('.', ',');
      return { id: String(index + 1), start: formatTime(startSec), end: formatTime(startSec + 4), text: line, translatedText: '' };
    });
  };

  // --- HÀM XỬ LÝ FILE CHUNG ---
  const processFiles = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const validExtensions = ['.srt', '.vtt', '.txt', '.mp3', '.mp4', '.wav', '.m4a'];
    const validFiles = Array.from(fileList).filter(file => validExtensions.some(ext => file.name.toLowerCase().endsWith(ext)));
    if (validFiles.length === 0) { alert('Vui lòng chọn file đúng định dạng hỗ trợ!'); return; }

    const newFilesPromises = validFiles.map(file => {
      return new Promise((resolve) => {
        const ext = file.name.slice((Math.max(0, file.name.lastIndexOf(".")) || Infinity)).toLowerCase();
        if (['.mp3', '.mp4', '.wav', '.m4a'].includes(ext)) {
          resolve({ id: Math.random().toString(36).substring(2, 9), name: file.name, isMedia: true, originalFile: file, subtitles: [] });
        } else {
          const reader = new FileReader();
          reader.onload = (e) => {
            let parsedSubs = [];
            if (ext === '.srt') parsedSubs = parseSRT(e.target.result);
            else if (ext === '.vtt') parsedSubs = parseVTT(e.target.result);
            else if (ext === '.txt') parsedSubs = parseTXT(e.target.result);
            resolve({ id: Math.random().toString(36).substring(2, 9), name: file.name, isMedia: false, subtitles: parsedSubs });
          };
          reader.readAsText(file);
        }
      });
    });

    const parsedFiles = (await Promise.all(newFilesPromises)).filter(Boolean);
    if (parsedFiles.length > 0) {
      setFilesData(prev => [...prev, ...parsedFiles]);
      setActiveProcessingId(parsedFiles[0].id); 
      setActiveTab('processing'); 
      setHasUploaded(true);
    }
  };

  const handleFileChange = (event) => processFiles(event.target.files);
  const triggerFileInput = () => fileInputRef.current.click();

  const handleDeleteFile = (e, id, isHistory) => {
    e.stopPropagation(); 
    let newProcessing = filesData;
    let newHistory = historyData;
    if (isHistory) { newHistory = historyData.filter(f => f.id !== id); setHistoryData(newHistory); } 
    else { newProcessing = filesData.filter(f => f.id !== id); setFilesData(newProcessing); }
    if (newProcessing.length === 0 && newHistory.length === 0) setHasUploaded(false);
  };

  const handleDeleteAll = (isHistory) => {
    const confirmDelete = window.confirm(isHistory ? "Xóa toàn bộ lịch sử dịch?" : "Xóa toàn bộ file đang xử lý?");
    if (!confirmDelete) return;
    if (isHistory) setHistoryData([]); else setFilesData([]);
    if ((isHistory && filesData.length === 0) || (!isHistory && historyData.length === 0)) setHasUploaded(false);
  };

  // --- LÕI GỌI AI & FFMPEG ---
  const processSingleFile = async (fileToProcess) => {
    if (!userApiKey.trim()) {
      throw new Error("MISSING_API_KEY");
    }

    const genAI = new GoogleGenerativeAI(userApiKey.trim());
    const model = genAI.getGenerativeModel({ model: selectedModel });
    let currentData = { ...fileToProcess };

    if (currentData.isMedia && currentData.subtitles.length === 0) {
      if (!isFfmpegLoaded) { throw new Error("Cỗ máy FFmpeg chưa sẵn sàng. Vui lòng thử lại!"); }

      setProcessingStatus(`⏳ ĐANG TRÍCH XUẤT & NÉN...`);
      const ffmpeg = ffmpegRef.current;
      const ext = currentData.name.slice((Math.max(0, currentData.name.lastIndexOf(".")) || Infinity)).toLowerCase() || '.mp4';
      
      const uniqueId = currentData.id;
      const inputName = `in_${uniqueId}${ext}`;
      const outputName = `out_${uniqueId}.mp3`;

      try {
        await ffmpeg.writeFile(inputName, await fetchFile(currentData.originalFile));
        await ffmpeg.exec(['-i', inputName, '-vn', '-ac', '1', '-b:a', '32k', outputName]);
        
        const mp3Data = await ffmpeg.readFile(outputName);
        const mp3Blob = new Blob([mp3Data.buffer], { type: 'audio/mp3' });
        
        const base64Audio = await new Promise(r => {
          const reader = new FileReader();
          reader.onload = e => r(e.target.result.split(',')[1]);
          reader.readAsDataURL(mp3Blob);
        });

        setProcessingStatus(`⏳ ĐANG NGHE & TẠO PHỤ ĐỀ...`);
        const mediaPart = { inlineData: { data: base64Audio, mimeType: "audio/mp3" } };
        const transcribePrompt = `Hãy nghe đoạn âm thanh/video này và tạo một file phụ đề ngôn ngữ gốc có độ chính xác cao nhất dưới định dạng SRT. KHÔNG bình luận, CHỈ trả về đoạn code SRT chuẩn.`;
        
        const transcribeResult = await model.generateContent([transcribePrompt, mediaPart]);
        const srtText = transcribeResult.response.text().replace(/```srt/g, '').replace(/```/g, '').trim();
        
        currentData = { ...currentData, subtitles: parseSRT(srtText), isMedia: false, originalFile: null }; 
        setFilesData(prev => prev.map(f => f.id === currentData.id ? currentData : f));
      } finally {
        try { await ffmpeg.deleteFile(inputName); } catch(e){}
        try { await ffmpeg.deleteFile(outputName); } catch(e){}
      }
    }

    if (currentData.subtitles.length > 0) {
      setProcessingStatus(`⏳ ĐANG DỊCH...`);
      const dataToTranslate = currentData.subtitles.map(sub => ({ id: sub.id, text: sub.text }));
      const translatePrompt = `
        Bạn là chuyên gia dịch thuật phụ đề. Hãy dịch các câu sau sang ${targetLanguage}.
        Văn phong: ${tone}.
        BẮT BUỘC: Trả về kết quả ĐÚNG ĐỊNH DẠNG JSON là một mảng object. Không thêm văn bản nào khác.
        Cấu trúc mẫu: [{"id": "1", "translatedText": "nội dung dịch"}, ...]
        
        Dữ liệu gốc:
        ${JSON.stringify(dataToTranslate)}
      `;

      const result = await model.generateContent(translatePrompt);
      const responseText = result.response.text();
      const cleanJsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      const translatedData = JSON.parse(cleanJsonString);

      const updatedSubtitles = currentData.subtitles.map(sub => {
        const transObj = translatedData.find(t => t.id === sub.id);
        return { ...sub, translatedText: transObj ? transObj.translatedText : sub.text };
      });
      currentData = { ...currentData, subtitles: updatedSubtitles };
    }
    return currentData;
  };

  const getTranslatedFileName = (originalName) => {
    if (originalName.includes('_translated')) return originalName;
    return originalName.replace(/\.[^/.]+$/, "") + `_${targetLanguage}_translated.srt`;
  };

  const handleTranslateCurrent = async () => {
    if (!activeFile) return;
    
    if (!userApiKey.trim()) {
      alert("Vui lòng nhập API Key của bạn ở khung bên phải trước khi dịch nhé!");
      return;
    }

    setIsTranslating(true);
    try {
      const finishedFile = await processSingleFile(activeFile);
      setFilesData(prev => prev.map(f => f.id === activeFile.id ? finishedFile : f));
      setHistoryData(prev => [{ ...finishedFile, id: `hist_${Date.now()}_${Math.random()}`, name: getTranslatedFileName(finishedFile.name) }, ...prev]);
    } catch (error) {
      console.error("Lỗi:", error);
      if (error.message === "MISSING_API_KEY") {
        alert("Vui lòng nhập API Key của bạn ở khung bên phải!");
      } else {
        alert(`Lỗi kết nối: Key API không hợp lệ hoặc file quá nặng.`);
      }
    } finally {
      setIsTranslating(false);
      setProcessingStatus('');
    }
  };

  const handleTranslateAll = async () => {
    if (filesData.length === 0) return;
    
    if (!userApiKey.trim()) {
      alert("Vui lòng nhập API Key của bạn ở khung bên phải trước khi bắt đầu dịch hàng loạt!");
      return;
    }

    setIsTranslating(true);
    const filesToProcess = [...filesData];

    for (let i = 0; i < filesToProcess.length; i++) {
      const currentProcessingFile = filesToProcess[i];
      const isAlreadyTranslated = currentProcessingFile.subtitles.length > 0 && currentProcessingFile.subtitles.every(sub => sub.translatedText);
      if (isAlreadyTranslated) continue;
      
      setActiveProcessingId(currentProcessingFile.id);
      setProcessingStatus('⏳ ĐANG CHUẨN BỊ...');
      await new Promise(r => setTimeout(r, 2000));

      try {
        const finishedFile = await processSingleFile(currentProcessingFile);
        setFilesData(prev => prev.map(f => f.id === currentProcessingFile.id ? finishedFile : f));
        setHistoryData(prev => [{ ...finishedFile, id: `hist_${Date.now()}_${Math.random()}`, name: getTranslatedFileName(finishedFile.name) }, ...prev]);
      } catch (error) {
        if (error.message === "MISSING_API_KEY") {
          alert("Vui lòng nhập API Key của bạn!");
          break;
        }

        const errorFile = {
          ...currentProcessingFile,
          subtitles: [{ 
            id: "1", start: "00:00:00,000", end: "00:00:05,000", 
            text: "LỖI XỬ LÝ", 
            translatedText: `❌ Lỗi: API Key hết hạn hoặc mạng yếu.\nApp đã tự động bỏ qua file này.` 
          }]
        };
        
        setFilesData(prev => prev.map(f => f.id === currentProcessingFile.id ? errorFile : f));
        continue; 
      }
    }
    
    setIsTranslating(false);
    setProcessingStatus('');
  };

  const handleDownload = () => {
    if (!activeFile) return;
    const srtContent = currentSubtitles.map((sub) => {
      const textToExport = sub.translatedText ? sub.translatedText : sub.text;
      return `${sub.id}\n${sub.start} --> ${sub.end}\n${textToExport}\n`;
    }).join('\n');
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = getTranslatedFileName(activeFile.name);
    link.click(); URL.revokeObjectURL(url);
  };

  const handleDownloadAllZip = async () => {
    if (currentList.length === 0) return;
    const zip = new JSZip();
    let hasFiles = false;
    currentList.forEach(file => {
      const hasTranslation = file.subtitles.some(sub => sub.translatedText && !sub.translatedText.includes('❌'));
      if (!hasTranslation) return; 
      
      const srtContent = file.subtitles.map((sub) => {
        const textToExport = sub.translatedText ? sub.translatedText : sub.text;
        return `${sub.id}\n${sub.start} --> ${sub.end}\n${textToExport}\n`;
      }).join('\n');
      zip.file(getTranslatedFileName(file.name), srtContent);
      hasFiles = true;
    });
    if (!hasFiles) { alert("Chưa có file nào hoàn thiện để tải về!"); return; }
    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url; link.download = `Subtitles_${activeTab}_${Date.now()}.zip`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-screen bg-[#121212] text-gray-300 font-sans relative">
      <input type="file" accept=".srt,.vtt,.txt,.mp3,.mp4,.wav,.m4a" multiple ref={fileInputRef} onChange={handleFileChange} className="hidden" />

      {/* 1. LEFT SIDEBAR */}
      {hasUploaded && (
        <div className="w-72 border-r border-gray-800 flex flex-col bg-[#1a1a1a]">
          <div className="flex text-xs font-bold border-b border-gray-800">
            <button onClick={() => setActiveTab('processing')} className={`flex-1 py-3 border-b-2 transition-colors ${activeTab === 'processing' ? 'text-orange-500 border-orange-500' : 'text-gray-500 border-transparent hover:text-gray-300'}`}>
              ĐANG XỬ LÝ ({filesData.length})
            </button>
            <button onClick={() => setActiveTab('history')} className={`flex-1 py-3 border-b-2 transition-colors ${activeTab === 'history' ? 'text-orange-500 border-orange-500' : 'text-gray-500 border-transparent hover:text-gray-300'}`}>
              LỊCH SỬ ({historyData.length})
            </button>
          </div>
          
          <div className="p-4 flex-1 space-y-2 overflow-y-auto custom-scrollbar">
            {currentList.length > 0 && (
               <div className="flex justify-between items-center mb-2 px-1">
                 <span className="text-[10px] text-gray-500 uppercase">{activeTab === 'processing' ? 'Danh sách gốc' : 'Bản dịch đã lưu'}</span>
                 <button onClick={() => handleDeleteAll(activeTab === 'history')} className="text-[10px] text-red-500/80 hover:text-red-500 transition-colors">Xóa tất cả</button>
               </div>
            )}

            {currentList.map((file) => {
              const isActive = activeFile?.id === file.id;
              const isTranslated = file.subtitles.length > 0 && file.subtitles.some(s => s.translatedText && !s.translatedText.includes('❌'));
              const isError = file.subtitles.some(s => s.translatedText && s.translatedText.includes('❌'));
              
              let icon = '📄';
              if (isError) icon = '⚠️';
              else if (isTranslated) icon = '✅';
              else if (file.isMedia) icon = '🎞️';
              
              return (
                <div 
                  key={file.id} 
                  onClick={() => activeTab === 'processing' ? setActiveProcessingId(file.id) : setActiveHistoryId(file.id)}
                  className={`group p-3 rounded border flex justify-between items-center text-sm cursor-pointer transition-all ${isActive ? 'bg-[#2a2a2a] border-orange-500/50 text-white' : 'bg-transparent border-gray-800 text-gray-500 hover:bg-[#242424]'} ${isError ? 'border-red-900/50 text-red-400' : ''}`}
                >
                  <div className="flex items-center overflow-hidden">
                    <span className="mr-2 text-xs">{icon}</span>
                    <span className="truncate max-w-[140px]" title={file.name}>{file.name}</span>
                  </div>
                  <button onClick={(e) => handleDeleteFile(e, file.id, activeTab === 'history')} className={`text-gray-600 hover:text-red-500 px-1 transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} title="Xóa file này">✕</button>
                </div>
              );
            })}

            {activeTab === 'processing' && (
              <button onClick={triggerFileInput} className="w-full mt-4 py-2 text-xs text-gray-400 border border-dashed border-gray-700 rounded hover:text-white transition-colors">
                + Thêm file khác
              </button>
            )}

            {activeTab === 'history' && currentList.length === 0 && (
              <div className="text-center text-xs text-gray-600 mt-10">Chưa có bản dịch nào được lưu.</div>
            )}
          </div>
          
          <div className="p-4 border-t border-gray-800 space-y-3">
            {isTranslating && processingStatus && (
              <div className="text-orange-500 text-[10px] text-center animate-pulse">{processingStatus}</div>
            )}

            <button 
              onClick={handleTranslateCurrent} 
              disabled={isTranslating || activeTab === 'history' || (currentSubtitles.length > 0 && currentSubtitles.every(s => s.translatedText))} 
              className={`w-full text-white font-bold py-3 rounded transition-colors ${
                isTranslating ? 'bg-orange-700 cursor-wait' : 
                (activeTab === 'history' || (currentSubtitles.length > 0 && currentSubtitles.every(s => s.translatedText))) ? 'bg-[#2a2a2a] text-gray-600 cursor-not-allowed' : 
                'bg-orange-500 hover:bg-orange-600'
              }`}
            >
              {isTranslating ? '⏳ ĐANG XỬ LÝ...' : (activeTab === 'history' ? 'ĐÃ DỊCH XONG' : '▶ DỊCH FILE NÀY')}
            </button>
            
            {activeTab === 'processing' && filesData.length > 1 && (
              <button 
                onClick={handleTranslateAll} 
                disabled={isTranslating} 
                className={`w-full text-white font-bold py-3 rounded border transition-colors ${
                  isTranslating ? 'border-orange-700 text-orange-700 cursor-wait bg-transparent' : 'border-orange-500 text-orange-500 hover:bg-orange-500/10 bg-transparent'
                }`}
              >
                {isTranslating ? '⏳ ĐANG AUTO DỊCH...' : '⏭ DỊCH TẤT CẢ'}
              </button>
            )}

            <div className="flex space-x-2">
              <button onClick={handleDownload} disabled={!activeFile || !currentSubtitles.some(s => s.translatedText && !s.translatedText.includes('❌'))} className="flex-1 font-bold py-3 rounded bg-[#242424] text-white border border-gray-600 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors text-xs">
                ⬇️ TẢI FILE
              </button>
              
              {currentList.length > 1 && (
                <button onClick={handleDownloadAllZip} disabled={!currentList.some(f => f.subtitles.some(s => s.translatedText && !s.translatedText.includes('❌')))} className="flex-1 font-bold py-3 rounded bg-[#242424] text-orange-500 border border-gray-600 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors text-xs">
                  📦 ZIP TẤT CẢ
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col">
        <div className="h-14 border-b border-gray-800 flex items-center px-6 bg-[#1a1a1a]">
          <div className="flex items-center space-x-2">
            <div className="bg-orange-500 p-1.5 rounded text-white font-bold text-xs">xA</div>
            <h1 className="text-white font-bold text-sm uppercase tracking-tighter">Subtitle Translator AI</h1>
          </div>
        </div>

        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
          {!hasUploaded ? (
            <div className="flex flex-col items-center justify-start pt-10 space-y-12 max-w-5xl mx-auto min-h-full">
              
              {/* KHU VỰC KÉO THẢ FILE */}
              <div onDragOver={(e)=>{e.preventDefault(); setIsDragging(true)}} onDragLeave={()=>setIsDragging(false)} onDrop={(e)=>{e.preventDefault(); setIsDragging(false); processFiles(e.dataTransfer.files)}}
                className={`w-full max-w-3xl py-20 border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition-all ${isDragging ? 'border-orange-500 bg-[#241e1a]' : 'border-gray-700 bg-[#181818]'}`}>
                <span className="text-4xl mb-4">⬆️</span>
                <h2 className="text-2xl text-white font-bold mb-2">Kéo thả các file Media hoặc Text vào đây</h2>
                <p className="text-gray-500 text-sm mb-8">Hỗ trợ định dạng: .mp4, .mp3, .wav, .m4a, .srt, .vtt, .txt</p>
                <button onClick={triggerFileInput} className="bg-white text-black font-bold py-3 px-8 rounded-lg hover:bg-gray-200 transition-colors shadow-lg">Chọn file từ máy tính</button>
              </div>

              {/* KHU VỰC GIỚI THIỆU (FOOTER SEO) */}
              <div className="w-full max-w-4xl mt-10 pb-12 border-t border-gray-800 pt-12">
                <div className="text-center mb-10">
                  <h3 className="text-xl font-bold text-white mb-3 tracking-wide">Về Subtitle Translator AI</h3>
                  <p className="text-sm text-gray-500 max-w-2xl mx-auto leading-relaxed">
                    Công cụ đột phá kết hợp sức mạnh của Trí tuệ nhân tạo và công nghệ xử lý đa phương tiện hiện đại, giúp bạn dễ dàng phá vỡ rào cản ngôn ngữ chỉ với vài cú click chuột.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-[#181818] p-6 rounded-xl border border-gray-800 hover:border-orange-500/50 transition-colors">
                    <div className="text-2xl mb-4">🧠</div>
                    <h4 className="text-white font-bold mb-3 text-sm uppercase tracking-wider">Sức mạnh AI</h4>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Không dừng lại ở việc dịch từng từ một cách rập khuôn, hệ thống sử dụng các mô hình ngôn ngữ thế hệ mới nhất. AI có khả năng "nghe hiểu" ngữ cảnh, giữ nguyên văn phong tự nhiên.
                    </p>
                  </div>

                  <div className="bg-[#181818] p-6 rounded-xl border border-gray-800 hover:border-orange-500/50 transition-colors">
                    <div className="text-2xl mb-4">⚡</div>
                    <h4 className="text-white font-bold mb-3 text-sm uppercase tracking-wider">FFmpeg WebAssembly</h4>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Trải nghiệm tốc độ xử lý đỉnh cao nhờ thư viện FFmpeg. Mọi file Video/Audio của bạn đều được bóc tách âm thanh trực tiếp trên thiết bị, đảm bảo quyền riêng tư tuyệt đối.
                    </p>
                  </div>

                  <div className="bg-[#181818] p-6 rounded-xl border border-gray-800 hover:border-orange-500/50 transition-colors">
                    <div className="text-2xl mb-4">🌍</div>
                    <h4 className="text-white font-bold mb-3 text-sm uppercase tracking-wider">Kết nối toàn cầu</h4>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Phụ đề là chìa khóa để nội dung của bạn tiếp cận khán giả quốc tế, đồng thời hỗ trợ người khiếm thính. Tiết kiệm hàng giờ gõ phụ đề thủ công để tập trung vào việc sáng tạo.
                    </p>
                  </div>
                </div>
                
                {/* BUTTON CHÍNH SÁCH BẢO MẬT */}
                <div className="text-center mt-10 flex flex-col items-center space-y-3">
                  <span className="text-[10px] text-gray-600 uppercase tracking-widest">
                    © {new Date().getFullYear()} Subtitle Translator AI. Được thiết kế để tối ưu hiệu suất.
                  </span>
                  <button 
                    onClick={() => setShowPrivacyPolicy(true)} 
                    className="flex items-center gap-2 text-xs font-bold text-orange-400 hover:text-white border border-orange-500/30 hover:border-orange-500 bg-orange-500/10 hover:bg-orange-500/20 px-5 py-2.5 rounded-full transition-all shadow-md"
                  >
                    🛡️ Chính sách bảo mật (Privacy Policy)
                  </button>
                </div>
              </div>

            </div>
          ) : (
            <>
              {!activeFile ? (
                <div className="h-full flex items-center justify-center text-gray-600 border-2 border-dashed border-gray-800 rounded-xl">
                  {activeTab === 'processing' ? 'Chưa có file nào để xử lý.' : 'Chưa có file lịch sử nào.'}
                </div>
              ) : (
                <div className="h-full flex space-x-4">
                  <div className="flex-1 flex flex-col bg-[#181818] border border-gray-800 rounded-lg overflow-hidden">
                    <div className="bg-[#242424] p-3 text-xs font-bold text-gray-400 flex justify-between">
                      <span>GỐC (ORIGINAL)</span>
                      <span className="text-gray-500 truncate max-w-[200px]">{activeFile.name}</span>
                    </div>
                    <div className="p-4 font-mono text-sm space-y-6 overflow-y-auto relative custom-scrollbar">
                      {activeFile.isMedia && currentSubtitles.length === 0 ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 p-8 text-center space-y-4">
                          <span className="text-4xl">🎞️</span>
                          <p>File của bạn đã được tải thành công.<br/>Hãy bấm <strong>DỊCH FILE NÀY</strong> để hệ thống nén, trích xuất và tạo phụ đề gốc.</p>
                        </div>
                      ) : (
                        currentSubtitles.map(sub => (
                          <div key={sub.id}>
                            <div className="text-gray-600 text-xs">{sub.start} &rarr; {sub.end}</div>
                            <div className="text-gray-200 mt-1 whitespace-pre-wrap">{sub.text}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  
                  <div className="flex-1 flex flex-col bg-[#181818] border border-gray-800 rounded-lg overflow-hidden">
                    <div className="bg-[#242424] p-3 text-xs font-bold text-orange-500 uppercase">
                      KẾT QUẢ ({targetLanguage} - {selectedModel.includes('flash') ? 'FLASH 3' : 'PRO 3.1'})
                    </div>
                    <div className="p-4 font-mono text-sm space-y-6 overflow-y-auto relative custom-scrollbar">
                      {activeFile.isMedia && currentSubtitles.length === 0 ? (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-600">
                          Kết quả dịch sẽ hiện tại đây...
                        </div>
                      ) : (
                        currentSubtitles.every(sub => !sub.translatedText) && !isTranslating ? (
                          <div className="absolute inset-0 flex items-center justify-center text-gray-600">Kết quả dịch sẽ hiện tại đây...</div>
                        ) : (
                          currentSubtitles.map(sub => (
                            <div key={sub.id}>
                              <div className="text-gray-600 text-xs">{sub.start} &rarr; {sub.end}</div>
                              <div className={`mt-1 whitespace-pre-wrap ${sub.translatedText?.includes('❌') ? 'text-red-400 font-bold' : 'text-orange-100'}`}>
                                {isTranslating && !sub.translatedText ? <span className="animate-pulse text-gray-500">Đang chờ dịch...</span> : sub.translatedText}
                              </div>
                            </div>
                          ))
                        )
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 3. RIGHT CONFIG PANEL (Đã tối ưu siêu gọn gàng) */}
      <div className="w-72 md:w-80 border-l border-gray-800 bg-[#1a1a1a] p-4 flex flex-col overflow-y-auto custom-scrollbar">
        <h3 className="text-xs font-bold text-white mb-3 uppercase tracking-widest">⚙️ Cấu hình dịch</h3>

        {/* Ô NHẬP API KEY */}
        <div className="mb-3 p-2.5 rounded-lg bg-orange-500/10 border border-orange-500/30">
          <label className="text-[9px] text-orange-500 mb-1.5 block font-bold tracking-wider">API KEY CỦA BẠN</label>
          <input 
            type="password" 
            placeholder="Nhập Gemini API Key..." 
            value={userApiKey}
            onChange={(e) => setUserApiKey(e.target.value)}
            className="w-full bg-[#121212] border border-orange-500/50 rounded p-1.5 text-xs focus:outline-none focus:border-orange-500 text-white placeholder-gray-600 transition-colors"
          />
          <div className="mt-1.5 text-right">
            <a 
              href="https://aistudio.google.com/app/apikey" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-[10px] text-orange-400 hover:text-orange-300 hover:underline inline-flex items-center"
            >
              Nhấn để lấy API Key ↗
            </a>
          </div>
        </div>
        
        <div className="mb-3">
          <label className="text-[9px] text-gray-500 mb-1.5 block font-bold tracking-wider">NGÔN NGỮ ĐÍCH</label>
          <select value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)} className="w-full bg-[#242424] border border-gray-700 rounded p-1.5 text-xs focus:outline-none focus:border-orange-500 text-white">
            <option value="Tiếng Việt">Tiếng Việt</option>
            <option value="English">English</option>
            <option value="Tiếng Pháp">Tiếng Pháp</option>
            <option value="Tiếng Nhật">Tiếng Nhật</option>
          </select>
        </div>

        <div className="mb-3">
          <label className="text-[9px] text-gray-500 mb-1.5 block font-bold tracking-wider">STYLE / TONE</label>
          <div className="space-y-1.5">
            {['Tự nhiên', 'Hàn lâm', 'Văn nói'].map((t) => (
              <button key={t} onClick={() => setTone(t)} className={`w-full text-left p-1.5 rounded border text-xs transition-all ${tone === t ? 'border-orange-500 bg-[#2a241e] text-orange-500' : 'border-gray-800 text-gray-400 hover:bg-[#242424] hover:text-white hover:border-gray-600'}`}>{t}</button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[9px] text-gray-500 mb-1.5 block font-bold tracking-wider">MÔ HÌNH AI</label>
          <div className="space-y-1.5">
            <button onClick={() => setSelectedModel('gemini-3-flash-preview')} className={`w-full flex justify-between items-center p-2 rounded border text-xs transition-all ${selectedModel === 'gemini-3-flash-preview' ? 'border-orange-500 bg-[#2a241e] text-orange-500' : 'border-gray-800 text-gray-500 hover:border-gray-600'}`}>
              Gemini 3 Flash (Nhanh)
              {selectedModel === 'gemini-3-flash-preview' && <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>}
            </button>
            <button onClick={() => setSelectedModel('gemini-3.1-pro-preview')} className={`w-full flex justify-between items-center p-2 rounded border text-xs transition-all ${selectedModel === 'gemini-3.1-pro-preview' ? 'border-orange-500 bg-[#2a241e] text-orange-500' : 'border-gray-800 text-gray-500 hover:border-gray-600'}`}>
              Gemini 3.1 Pro (Chính xác)
              {selectedModel === 'gemini-3.1-pro-preview' && <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>}
            </button>
          </div>
        </div>

      </div>

      {/* 4. CỬA SỔ POP-UP CHÍNH SÁCH BẢO MẬT (MODAL) */}
      {showPrivacyPolicy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm transition-opacity">
          <div className="bg-[#1a1a1a] border border-gray-700 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            
            <div className="p-5 border-b border-gray-800 flex justify-between items-center bg-[#242424] rounded-t-xl">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🛡️</span> Chính sách Bảo mật & Điều khoản
              </h2>
              <button 
                onClick={() => setShowPrivacyPolicy(false)} 
                className="text-gray-400 hover:text-red-500 text-2xl leading-none transition-colors"
              >&times;</button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar text-sm text-gray-300 space-y-6 leading-relaxed">
              <section>
                <h3 className="text-orange-400 font-bold mb-2 uppercase text-xs tracking-widest">1. Thu thập & Lưu trữ API Key</h3>
                <p>
                  Chúng tôi đặt quyền riêng tư của bạn lên hàng đầu. <strong>Subtitle Translator AI tuyệt đối KHÔNG lưu trữ, không ghi log và không gửi API Key của bạn đến bất kỳ máy chủ nào của chúng tôi.</strong> 
                  API Key mà bạn cung cấp chỉ được lưu tạm thời trên trình duyệt của chính bạn (Client-side) và được sử dụng để giao tiếp trực tiếp với máy chủ Google Gemini.
                </p>
              </section>

              <section>
                <h3 className="text-orange-400 font-bold mb-2 uppercase text-xs tracking-widest">2. Xử lý File Media</h3>
                <p>
                  Toàn bộ quá trình bóc tách và nén âm thanh từ video đều được thực hiện <strong>100% cục bộ ngay trên thiết bị của bạn</strong> thông qua công nghệ FFmpeg WebAssembly. File gốc của bạn không bao giờ rời khỏi máy tính. 
                </p>
              </section>

              <section>
                <h3 className="text-orange-400 font-bold mb-2 uppercase text-xs tracking-widest">3. Sử dụng Dữ liệu & Cookie</h3>
                <p>
                  Trang web này có thể sử dụng các cookie tiêu chuẩn của bên thứ ba để phân tích lưu lượng ẩn danh hoặc phân phối quảng cáo phù hợp. Chúng tôi không bán hay chia sẻ dữ liệu cá nhân nào của bạn.
                </p>
              </section>

              <section>
                <h3 className="text-orange-400 font-bold mb-2 uppercase text-xs tracking-widest">4. Từ chối trách nhiệm</h3>
                <p>
                  Chất lượng dịch thuật phụ thuộc hoàn toàn vào AI của Google Gemini. Chúng tôi không chịu trách nhiệm về nội dung bạn dịch hoặc chia sẻ.
                </p>
              </section>
            </div>

            <div className="p-4 border-t border-gray-800 flex justify-end bg-[#242424] rounded-b-xl">
              <button 
                onClick={() => setShowPrivacyPolicy(false)} 
                className="bg-orange-500 text-white px-8 py-2 rounded-lg hover:bg-orange-600 font-bold text-sm transition-colors shadow-lg"
              >
                ĐÃ HIỂU VÀ ĐÓNG
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default App;