with open('pages/OfficeUserListPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Main horizontal container
old_main_start = '<div className="flex gap-6 pb-12 pt-4 overflow-x-auto min-h-[60vh] snap-x snap-mandatory items-start scrollbar-thin scrollbar-thumb-teal-500/20 scrollbar-track-transparent">'
new_main_start = '<DragScrollContainer className="flex gap-6 pb-12 pt-4 overflow-x-auto min-h-[60vh] snap-x snap-mandatory items-start scrollbar-thin scrollbar-thumb-teal-500/20 scrollbar-track-transparent">'

content = content.replace(old_main_start, new_main_start)

# The end of this map is around here:
#                                 )}
#                             </div>
#                         );
#                     })}
#                 </div>
#             )}
#             {/* QUICK REVIEW MODAL */}
old_main_end = """                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* QUICK REVIEW MODAL */}"""
new_main_end = """                                )}
                            </div>
                        );
                    })}
                </DragScrollContainer>
            )}

            {/* QUICK REVIEW MODAL */}"""
content = content.replace(old_main_end, new_main_end)

# 2. The vertical column container
old_col_start = '<div className="flex flex-col gap-4 overflow-y-auto h-full scrollbar-thin scrollbar-thumb-teal-500/10 scrollbar-track-transparent pb-4 pr-1">'
new_col_start = '<DragScrollContainer className="flex flex-col gap-4 overflow-y-auto h-full scrollbar-thin scrollbar-thumb-teal-500/10 scrollbar-track-transparent pb-4 pr-1">'
content = content.replace(old_col_start, new_col_start)

old_col_end = """                                                        <div className="text-xs text-teal-400 font-bold uppercase tracking-wider group-hover:translate-x-1 transition-transform">
                                                            Details <ArrowRight size={14} className="inline ml-1" />
                                                        </div>
                                                    </div>
                                                </SpotlightCard>
                                            );
                                        })}
                                    </div>
                                )}"""
new_col_end = """                                                        <div className="text-xs text-teal-400 font-bold uppercase tracking-wider group-hover:translate-x-1 transition-transform">
                                                            Details <ArrowRight size={14} className="inline ml-1" />
                                                        </div>
                                                    </div>
                                                </SpotlightCard>
                                            );
                                        })}
                                    </DragScrollContainer>
                                )}"""
content = content.replace(old_col_end, new_col_end)

with open('pages/OfficeUserListPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Drag scroll patch applied!")
