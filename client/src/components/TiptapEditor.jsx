import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import Heading from '@tiptap/extension-heading';
import ListItem from '@tiptap/extension-list-item';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import { Node, mergeAttributes } from '@tiptap/core';
import CodeBlock from '@tiptap/extension-code-block';
import ResizeImage from 'tiptap-extension-resize-image';
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import FontSize from './tiptap-extension-font-size'
import { processCodeBlocks } from './utils/codeBlockHelper';
import { API_BASE } from '../config';

// Page break extension for manual page breaks
const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  selectable: false,
  parseHTML() {
    return [{ tag: 'hr.page-break' }]
  },
  renderHTML() {
    return ['hr', { class: 'page-break' }]
  },
  addCommands() {
    return {
      setPageBreak: () => ({ chain }) => {
        return chain().insertContent('<hr class="page-break" />').run()
      },
    }
  },
});

// Custom CodeBlock extension that ensures code stays in a single block - simplified version
const SimpleCodeBlock = Node.create({
  name: 'codeBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  defining: true,
  code: true,
  
  addAttributes() {
    return {
      language: {
        default: null,
      },
    }
  },
  
  parseHTML() {
    return [
      { tag: 'pre', preserveWhitespace: 'full' },
      { tag: 'code', preserveWhitespace: 'full' },
    ]
  },
  
  renderHTML({ HTMLAttributes }) {
    return ['pre', ['code', HTMLAttributes, 0]]
  },
  
  addCommands() {
    return {
      setCodeBlock: () => ({ commands }) => {
        return commands.setNode(this.name)
      },
      toggleCodeBlock: () => ({ commands }) => {
        return commands.toggleNode(this.name, 'paragraph')
      },
    }
  },
  
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-c': () => this.editor.commands.toggleCodeBlock(),
      // Override 'Enter' to insert a newline instead of splitting the code block
      Enter: ({ editor }) => {
        if (editor.isActive('codeBlock')) {
          editor.commands.insertContent('\n')
          return true
        }
        return false
      },
      // Ensure Tab key inserts spaces instead of moving focus
      Tab: ({ editor }) => {
        if (editor.isActive('codeBlock')) {
          editor.commands.insertContent('  ')
          return true
        }
        return false
      },
    }
  },
});

export default function TiptapEditor({ value, onChange }) {
  // State for link handling
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [linkPosition, setLinkPosition] = useState({ x: 0, y: 0 });
  
  // Refs
  const linkFormRef = useRef(null);
  const editorContentRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        listItem: false,
        bulletList: false,
        orderedList: false,
        codeBlock: false, // Disable default code block
      }),
      SimpleCodeBlock, // Use our simpler code block implementation
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Heading.configure({ levels: [2, 3] }),
      ListItem,
      BulletList.configure({
        HTMLAttributes: {
          class: 'list-disc ml-2'
        }
      }),
      OrderedList.configure({
        HTMLAttributes: {
          class: 'list-decimal ml-2'
        }
      }),
      ResizeImage,
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Placeholder.configure({
        placeholder: 'Write your question description here...',
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
      }),
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          class: 'text-blue-600 underline'
        }
      }),
      PageBreak
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'outline-none w-full p-3 min-h-[250px] prose prose-sm max-w-none line-spacing-tight',
      },
    },
  });

  // Sync editor content with external value changes
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  // Handle clicking outside the link form
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (linkFormRef.current && !linkFormRef.current.contains(e.target)) {
        setShowLinkInput(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [linkFormRef]);

  // Add styles for page breaks and line spacing
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      /* Page break styles */
      hr.page-break {
        page-break-after: always;
        break-after: page;
        height: 0;
        border: none;
        border-top: 2px dashed #bbb;
        margin: 2rem 0;
        position: relative;
      }
      hr.page-break::after {
        content: 'Page Break';
        position: absolute;
        top: -12px;
        left: 50%;
        transform: translateX(-50%);
        background: #f8fafc;
        padding: 0 10px;
        font-size: 0.75rem;
        color: #64748b;
      }
      @media print {
        hr.page-break {
          border: none;
          height: 0;
          margin: 0;
        }
        hr.page-break::after {
          display: none;
        }
      }

      /* Line spacing */
      .line-spacing-tight p {
        margin-top: 0.5em;
        margin-bottom: 0.5em;
        line-height: 1.3;
      }
      .line-spacing-tight h2, .line-spacing-tight h3 {
        margin-top: 1em;
        margin-bottom: 0.5em;
      }
      .line-spacing-tight ul, .line-spacing-tight ol {
        margin-top: 0.5em;
        margin-bottom: 0.5em;
      }
      .line-spacing-tight li {
        margin-top: 0.25em;
        margin-bottom: 0.25em;
      }
      
      /* Code block styling - very simple and clean */
      pre {
        background-color: #f8f8f8 !important;
        border: 1px solid #e2e8f0 !important;
        border-radius: 6px !important;
        padding: 0.75rem 1rem !important;
        margin: 1rem 0 !important;
        overflow-x: auto !important;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
        font-size: 0.9rem !important;
        line-height: 1.5 !important;
        tab-size: 2 !important;
        white-space: pre !important;
      }
      
      pre code {
        background-color: transparent !important;
        padding: 0 !important;
        border: none !important;
        display: block !important;
        color: #374151 !important;
        white-space: pre !important;
        font-family: inherit !important;
        font-size: inherit !important;
      }
      
      code {
        background-color: #f1f5f9 !important;
        border-radius: 3px !important;
        padding: 0.1em 0.3em !important;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
        font-size: 0.9em !important;
        color: #4b5563 !important;
      }
      
      /* Ensure line breaks in code blocks don't break the code block */
      .ProseMirror pre br {
        display: inline !important;
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  if (!editor) {
    return <div className="border rounded-md bg-gray-50 h-[300px] flex items-center justify-center">Loading editor...</div>;
  }

  // Handle image upload
  const handleImageUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    
    input.onchange = async () => {
      if (input.files?.length) {
        const file = input.files[0];
        
        // Upload to server instead of using base64
        try {
          const formData = new FormData();
          formData.append('image', file);
          const response = await axios.post(`${API_BASE}/api/questions/upload-image`, formData);
          
          // Use the returned URL in the editor
          if (response.data.success) {
            editor.chain().focus().setImage({ src: response.data.url }).run();
          } else {
            console.error('Image upload failed:', response.data);
            alert('Failed to upload image');
          }
        } catch (error) {
          console.error('Error uploading image:', error);
          alert('Error uploading image');
        }
      }
    };
    
    input.click();
  };

  // Handle link addition
  const handleLinkAdd = () => {
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }

    const { state, view } = editor;
    const { from, to } = state.selection;

    const hasTextSelected = from !== to;
    const selectedText = hasTextSelected ? state.doc.textBetween(from, to) : '';

    const domPos = view.coordsAtPos(from);
    const rect = view.dom.getBoundingClientRect();

    const x = domPos.left - rect.left;
    const y = domPos.bottom - rect.top + 10;

    setLinkPosition({ x, y });
    setHasSelection(hasTextSelected);
    setLinkText(selectedText);
    setLinkUrl('');
    setShowLinkInput(true);
  };

  // Submit link
  const submitLink = () => {
    if (!linkUrl) {
      setShowLinkInput(false);
      return;
    }
    const url = linkUrl.startsWith('http') ? linkUrl : `http://${linkUrl}`;
    if (hasSelection) {
      editor.chain().focus().setLink({ href: url }).run();
    } else if (linkText) {
      editor.chain()
        .focus()
        .insertContent(`<a href="${url}">${linkText}</a>`)
        .run();
    }
    setShowLinkInput(false);
  };

  // Wait for images to load
  const waitForImagesToLoad = async (container) => {
    const images = container.querySelectorAll('img');
    await Promise.all(Array.from(images).map(img =>
      img.complete ? Promise.resolve() : new Promise(resolve => {
        img.onload = img.onerror = resolve;
      })
    ));
  };

  // PDF export function
  const handleExportPDF = async () => {
    if (!editor) return;
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = editor.getHTML();
    document.body.appendChild(tempContainer);

    await waitForImagesToLoad(tempContainer);
    
    await html2pdf()
      .set({
        margin: 0,
        filename: 'document.pdf',
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
      })
      .from(tempContainer)
      .save();

    document.body.removeChild(tempContainer);
  };

  // Update onChange to process content
  useEffect(() => {
    if (editor) {
      const originalOnUpdate = editor.options.onUpdate;
      editor.options.onUpdate = ({ editor }) => {
        const content = editor.getHTML();
        const processedContent = processCodeBlocks(content);
        onChange(processedContent);
      };
    }
  }, [editor, onChange]);

  // Process initial content
  useEffect(() => {
    if (editor && value) {
      const processedValue = processCodeBlocks(value);
      if (processedValue !== value) {
        editor.commands.setContent(processedValue);
      }
    }
  }, []);

  return (
    <div className="border rounded-md overflow-hidden shadow-sm transition focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400 position-relative">
      <div className="bg-gray-100 border-b p-1 flex items-center flex-wrap gap-1 sticky top-0 z-10">
        {/* Font Family */}
        <select
          onChange={e => editor.chain().focus().setFontFamily(e.target.value).run()}
          value={editor.getAttributes('textStyle').fontFamily || 'inherit'}
        >
          <option value="inherit">Default</option>
          <option value="Arial">Arial</option>
          <option value="Georgia">Georgia</option>
          <option value="Courier New">Courier New</option>
        </select>
        {/* Font Size */}
        <select
          onChange={e => editor.chain().focus().setFontSize(e.target.value).run()}
          value={editor.getAttributes('textStyle').fontSize || '16px'}
        >
          <option value="12px">12</option>
          <option value="14px">14</option>
          <option value="16px">16</option>
          <option value="18px">18</option>
          <option value="24px">24</option>
        </select>
        {/* Font Color */}
        <input
          type="color"
          value={
            editor.getAttributes('textStyle').color ||
            editor.getAttributes('color').color ||
            '#000000'
          }
          onChange={e => editor.chain().focus().setColor(e.target.value).run()}
          title="Text color"
        />

        <div className="h-6 border-r border-gray-300 mx-1"></div>
        
        {/* Text formatting */}
        <EditorButton 
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          title="Bold"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path></svg>}
        />
        
        <EditorButton 
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          title="Italic"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="4" x2="10" y2="4"></line><line x1="14" y1="20" x2="5" y2="20"></line><line x1="15" y1="4" x2="9" y2="20"></line></svg>}
        />

        <div className="h-6 border-r border-gray-300 mx-1"></div>
        
        {/* Headings */}
        <EditorButton 
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive('heading', { level: 2 })}
          title="Heading 2"
          text="H2"
        />
        
        <EditorButton 
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          isActive={editor.isActive('heading', { level: 3 })}
          title="Heading 3"
          text="H3"
        />
        
        <div className="h-6 border-r border-gray-300 mx-1"></div>

        {/* Lists */}
        <EditorButton 
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          title="Bullet List"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>}
        />
        
        <EditorButton 
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
          title="Ordered List"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="10" y1="6" x2="21" y2="6"></line><line x1="10" y1="12" x2="21" y2="12"></line><line x1="10" y1="18" x2="21" y2="18"></line><path d="M4 6h1v4"></path><path d="M4 10h2"></path><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"></path></svg>}
        />
        
        <div className="h-6 border-r border-gray-300 mx-1"></div>

        {/* Alignment */}
        <EditorButton 
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          isActive={editor.isActive({ textAlign: 'left' })}
          title="Align Left"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="17" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>}
        />

        <EditorButton 
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          isActive={editor.isActive({ textAlign: 'center' })}
          title="Align Centre"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="10" x2="6" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="18" y1="18" x2="6" y2="18"></line></svg>}
        />

        <EditorButton 
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          isActive={editor.isActive({ textAlign: 'right' })}
          title="Align Right"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="21" y1="10" x2="7" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="21" y1="18" x2="7" y2="18"></line></svg>}
        />

        <EditorButton 
          onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          isActive={editor.isActive({ textAlign: 'justify' })}
          title="Justify"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="21" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="21" y1="18" x2="3" y2="18"></line></svg>}
        />

        <div className="h-6 border-r border-gray-300 mx-1"></div>

        {/* Code Block - Simple Implementation */}
        <EditorButton 
          onClick={() => {
            editor.chain().focus().toggleCodeBlock().run();
          }}
          isActive={editor.isActive('codeBlock')}
          title="Code Block"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>}
        />
        
        {/* Link */}
        <EditorButton
          onClick={handleLinkAdd}
          isActive={editor.isActive('link')}
          title={editor.isActive('link') ? "Remove Link" : "Add Link"}
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>}
        />

        {/* Image */}
        <EditorButton 
          onClick={handleImageUpload}
          title="Insert Image"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>}
        />

        <div className="h-6 border-r border-gray-300 mx-1"></div>

        {/* PDF Export */}
        <EditorButton
          onClick={handleExportPDF}
          title="Export to PDF"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>}
        />

        <div className="h-6 border-r border-gray-300 mx-1"></div>

        {/* Page Break */}
        <EditorButton
          onClick={() => editor.chain().focus().setPageBreak().run()}
          title="Insert Page Break"
          icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><polyline points="8 18 3 12 8 6"></polyline><polyline points="16 6 21 12 16 18"></polyline></svg>}
        />
      </div>

      <div className="relative">
        <div className="overflow-y-auto max-h-[600px]" ref={editorContentRef}>
          <EditorContent editor={editor} />
        </div>

        {/* Link input form */}
        {showLinkInput && (
          <div 
            ref={linkFormRef}
            className="absolute bg-white z-10 border rounded shadow-lg p-3 min-w-[260px]"
            style={{ 
              left: `${Math.min(linkPosition.x, editor.view.dom.offsetWidth - 270)}px`,
              top: `${linkPosition.y}px`,
            }}
          >
            {!hasSelection && (
              <div className="mb-2">
                <label className="block text-sm font-medium mb-1 text-gray-700">Text</label>
                <input 
                  type="text" 
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  placeholder="Link text"
                  className="w-full border rounded py-1.5 px-3 text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setShowLinkInput(false);
                  }}
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">URL</label>
              <input
                type="text"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="Type or paste a link"
                className="w-full border rounded py-1.5 px-3 text-sm"
                autoFocus={hasSelection}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitLink();
                  else if (e.key === 'Escape') setShowLinkInput(false);
                }}
              />
            </div>

            <div className="flex justify-end mt-3">
              <button
                onClick={() => setShowLinkInput(false)}
                className="mr-2 px-2.5 py-1 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={submitLink}
                className="px-2.5 py-1 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>
      
      <div className="bg-gray-50 border-t px-3 py-1 text-xs text-gray-500">
        Tip: Use toolbar buttons for formatting or upload images directly
      </div>
    </div>
  );
}

// Helper component for editor buttons
function EditorButton({ onClick, isActive, title, icon, text }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e);
      }}
      className={`p-1.5 rounded-md transition-colors hover:bg-gray-200 ${
        isActive ? 'bg-blue-100 text-blue-800' : 'text-gray-700'
      }`}
      title={title}
    >
      {icon || <span className="font-medium">{text}</span>}
    </button>
  );
}
